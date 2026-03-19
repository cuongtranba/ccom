package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/p2p/discovery/mdns"
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
	mu          sync.RWMutex
}

func NewP2PHost(ctx context.Context, ident *NodeIdentity, cfg *NodeConfig, store *Store) (*P2PHost, error) {
	listenAddr := fmt.Sprintf("/ip4/0.0.0.0/tcp/%d", cfg.Network.ListenPort)

	opts := []libp2p.Option{
		libp2p.Identity(ident.PrivKey),
		libp2p.ListenAddrStrings(listenAddr),
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

func (p *P2PHost) Close() error {
	if p.mdnsService != nil {
		p.mdnsService.Close()
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
