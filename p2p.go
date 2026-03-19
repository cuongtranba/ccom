package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"github.com/libp2p/go-libp2p"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/p2p/discovery/mdns"
	drouting "github.com/libp2p/go-libp2p/p2p/discovery/routing"
	dutil "github.com/libp2p/go-libp2p/p2p/discovery/util"
	"github.com/rs/zerolog/log"
	multiaddr "github.com/multiformats/go-multiaddr"
)

const ProtocolID = "/inv/1.0.0"

// P2PHost wraps a libp2p host with inventory-specific functionality.
type P2PHost struct {
	host        host.Host
	identity    *NodeIdentity
	config      *NodeConfig
	store       *Store
	cache       *MessageCache
	limiter     *PeerRateLimiter
	mdnsService mdns.Service
	dht         *dht.IpfsDHT
	mu          sync.RWMutex
}

func NewP2PHost(ctx context.Context, ident *NodeIdentity, cfg *NodeConfig, store *Store) (*P2PHost, error) {
	listenAddr := fmt.Sprintf("/ip4/0.0.0.0/tcp/%d", cfg.Network.ListenPort)

	opts := []libp2p.Option{
		libp2p.Identity(ident.PrivKey),
		libp2p.ListenAddrStrings(listenAddr),
	}

	// Enable relay client + hole punching for NAT traversal
	if cfg.Network.EnableRelay {
		opts = append(opts,
			libp2p.EnableRelay(),
			libp2p.EnableRelayService(),
			libp2p.EnableAutoRelayWithPeerSource(func(ctx context.Context, numPeers int) <-chan peer.AddrInfo {
				ch := make(chan peer.AddrInfo, numPeers)
				go func() {
					defer close(ch)
					for _, p := range dht.DefaultBootstrapPeers {
						pi, err := peer.AddrInfoFromP2pAddr(p)
						if err != nil {
							continue
						}
						select {
						case ch <- *pi:
						case <-ctx.Done():
							return
						}
					}
				}()
				return ch
			}),
			libp2p.EnableHolePunching(),
			libp2p.NATPortMap(),
			libp2p.EnableAutoNATv2(),
		)
	}

	h, err := libp2p.New(opts...)
	if err != nil {
		return nil, fmt.Errorf("create libp2p host: %w", err)
	}

	p2pHost := &P2PHost{
		host:     h,
		identity: ident,
		config:   cfg,
		store:    store,
		cache:    NewMessageCache(cfg.Security.SeenCacheSize, cfg.Security.ReplayWindow),
		limiter:  NewPeerRateLimiter(cfg.Security.MaxMessageRate, cfg.Security.ThrottleDuration, cfg.Security.ThrottleDuration),
	}

	// Bootstrap DHT for peer discovery and relay finding
	if cfg.Network.EnableDHT {
		kademliaDHT, err := dht.New(ctx, h, dht.Mode(dht.ModeAutoServer))
		if err != nil {
			h.Close()
			return nil, fmt.Errorf("create DHT: %w", err)
		}
		if err := kademliaDHT.Bootstrap(ctx); err != nil {
			h.Close()
			return nil, fmt.Errorf("bootstrap DHT: %w", err)
		}
		p2pHost.dht = kademliaDHT

		// Connect to IPFS bootstrap peers for DHT seeding
		go p2pHost.connectBootstrapPeers(ctx)

		// Advertise and discover peers via DHT using project rendezvous
		go p2pHost.dhtDiscovery(ctx, cfg.Node.Project)
	}

	// Connect to configured bootstrap peers
	if len(cfg.Network.BootstrapPeers) > 0 {
		go p2pHost.connectConfiguredPeers(ctx)
	}

	// Set up mDNS discovery if enabled
	if cfg.Network.EnableMDNS {
		rendezvous := mdnsServiceName(cfg.Node.Project)
		mdnsSvc := mdns.NewMdnsService(h, rendezvous, &mdnsNotifee{host: p2pHost})
		if err := mdnsSvc.Start(); err != nil {
			h.Close()
			return nil, fmt.Errorf("start mDNS: %w", err)
		}
		p2pHost.mdnsService = mdnsSvc
	}

	return p2pHost, nil
}

// connectBootstrapPeers connects to the default IPFS DHT bootstrap nodes.
func (p *P2PHost) connectBootstrapPeers(ctx context.Context) {
	bootstrapPeers := dht.DefaultBootstrapPeers
	for _, addr := range bootstrapPeers {
		pi, err := peer.AddrInfoFromP2pAddr(addr)
		if err != nil {
			continue
		}
		if err := p.host.Connect(ctx, *pi); err != nil {
			log.Debug().Err(err).Str("peer", pi.ID.String()).Msg("failed to connect to bootstrap peer")
		} else {
			log.Debug().Str("peer", pi.ID.String()).Msg("connected to bootstrap peer")
		}
	}
}

// connectConfiguredPeers connects to peers listed in the config.
func (p *P2PHost) connectConfiguredPeers(ctx context.Context) {
	for _, addrStr := range p.config.Network.BootstrapPeers {
		addr, err := multiaddr.NewMultiaddr(addrStr)
		if err != nil {
			log.Warn().Err(err).Str("addr", addrStr).Msg("invalid bootstrap peer address")
			continue
		}
		pi, err := peer.AddrInfoFromP2pAddr(addr)
		if err != nil {
			log.Warn().Err(err).Str("addr", addrStr).Msg("failed to parse bootstrap peer")
			continue
		}
		if err := p.host.Connect(ctx, *pi); err != nil {
			log.Warn().Err(err).Str("peer", pi.ID.String()).Msg("failed to connect to configured peer")
		} else {
			log.Info().Str("peer", pi.ID.String()).Msg("connected to configured peer")
		}
	}
}

// dhtDiscovery advertises this node and continuously discovers peers
// under a project-specific rendezvous key via the Kademlia DHT.
func (p *P2PHost) dhtDiscovery(ctx context.Context, project string) {
	rendezvous := "inv/project/" + project
	discovery := drouting.NewRoutingDiscovery(p.dht)

	// Wait for bootstrap peers to connect before advertising
	time.Sleep(5 * time.Second)

	// Advertise ourselves
	dutil.Advertise(ctx, discovery, rendezvous)
	log.Info().Str("rendezvous", rendezvous).Msg("DHT: advertising on rendezvous")

	// Periodically search for peers
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		peers, err := dutil.FindPeers(ctx, discovery, rendezvous)
		if err != nil {
			log.Debug().Err(err).Msg("DHT: find peers failed")
		} else {
			for _, pi := range peers {
				if pi.ID == p.host.ID() || len(pi.Addrs) == 0 {
					continue
				}
				if p.host.Network().Connectedness(pi.ID) == 1 { // already connected
					continue
				}
				if err := p.host.Connect(ctx, pi); err != nil {
					log.Debug().Err(err).Str("peer", pi.ID.String()).Msg("DHT: failed to connect to discovered peer")
				} else {
					log.Info().Str("peer", pi.ID.String()).Msg("DHT: connected to discovered peer")
				}
			}
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (p *P2PHost) Close() error {
	if p.mdnsService != nil {
		p.mdnsService.Close()
	}
	if p.dht != nil {
		p.dht.Close()
	}
	return p.host.Close()
}

func (p *P2PHost) Addrs() []multiaddr.Multiaddr {
	hostAddr, _ := multiaddr.NewMultiaddr(fmt.Sprintf("/p2p/%s", p.host.ID()))
	var fullAddrs []multiaddr.Multiaddr
	for _, addr := range p.host.Addrs() {
		fullAddrs = append(fullAddrs, addr.Encapsulate(hostAddr))
	}
	return fullAddrs
}

// ShareableAddrs returns human-readable multiaddr strings suitable for sharing.
func (p *P2PHost) ShareableAddrs() []string {
	addrs := p.Addrs()
	result := make([]string, len(addrs))
	for i, a := range addrs {
		result[i] = a.String()
	}
	return result
}

// ConnectedPeerCount returns the number of connected peers.
func (p *P2PHost) ConnectedPeerCount() int {
	return len(p.host.Network().Peers())
}

func (p *P2PHost) PeerIDString() string {
	return p.host.ID().String()
}

func (p *P2PHost) ConnectPeer(ctx context.Context, addr multiaddr.Multiaddr) error {
	peerInfo, err := peer.AddrInfoFromP2pAddr(addr)
	if err != nil {
		return fmt.Errorf("parse peer address: %w", err)
	}

	if err := p.host.Connect(ctx, *peerInfo); err != nil {
		return fmt.Errorf("connect to peer: %w", err)
	}

	return nil
}

func (p *P2PHost) ConnectedPeers() []peer.ID {
	return p.host.Network().Peers()
}

func (p *P2PHost) Host() host.Host {
	return p.host
}

// mdnsNotifee handles mDNS peer discovery events.
type mdnsNotifee struct {
	host *P2PHost
}

func (n *mdnsNotifee) HandlePeerFound(pi peer.AddrInfo) {
	if pi.ID == n.host.host.ID() {
		return
	}
	ctx := context.Background()
	_ = n.host.host.Connect(ctx, pi)
}

// mdnsServiceName converts a project name into a valid DNS-SD service type.
// DNS-SD service types must follow _name._udp format with 1-15 char service name.
// We hash the project to ensure a short, valid, project-specific service name.
func mdnsServiceName(project string) string {
	h := sha256.Sum256([]byte(project))
	short := hex.EncodeToString(h[:4]) // 8 hex chars
	return fmt.Sprintf("_inv%s._udp", short)
}
