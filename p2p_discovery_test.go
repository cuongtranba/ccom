package main

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/suite"
	multiaddr "github.com/multiformats/go-multiaddr"
)

type P2PDiscoverySuite struct {
	suite.Suite
}

func TestP2PDiscoverySuite(t *testing.T) {
	suite.Run(t, new(P2PDiscoverySuite))
}

// newHost creates a P2PHost with a fresh identity, store, and config.
// Cleanup is registered automatically via s.T().Cleanup.
func (s *P2PDiscoverySuite) newHost(name, project string, enableMDNS bool) (*P2PHost, *Store) {
	tmpDir := s.T().TempDir()
	ident, err := GenerateIdentity()
	s.Require().NoError(err)

	cfg := DefaultNodeConfig()
	cfg.Node.Name = name
	cfg.Node.Vertical = VerticalDev
	cfg.Node.Project = project
	cfg.Node.Owner = "test-owner"
	cfg.Network.ListenPort = 0
	cfg.Network.EnableDHT = false
	cfg.Network.EnableMDNS = enableMDNS

	store, err := NewStore(tmpDir + "/test.db")
	s.Require().NoError(err)

	host, err := NewP2PHost(context.Background(), ident, cfg, store)
	s.Require().NoError(err)

	s.T().Cleanup(func() {
		host.Close()
		store.Close()
	})

	return host, store
}

// TestHostCreation verifies a fresh P2PHost has valid addresses and peer ID.
func (s *P2PDiscoverySuite) TestHostCreation() {
	host, _ := s.newHost("node-alpha", "proj-alpha", false)

	s.GreaterOrEqual(len(host.Addrs()), 1, "should have at least one listen address")
	s.NotEmpty(host.PeerIDString())
	s.True(strings.HasPrefix(host.PeerIDString(), "12D3KooW"),
		"Ed25519 peer IDs start with 12D3KooW, got: %s", host.PeerIDString())
	s.Equal(0, host.ConnectedPeerCount())
}

// TestDirectConnect verifies two hosts can connect and see each other bidirectionally.
func (s *P2PDiscoverySuite) TestDirectConnect() {
	hostA, _ := s.newHost("node-a", "proj-conn", false)
	hostB, _ := s.newHost("node-b", "proj-conn", false)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err := hostB.ConnectPeer(ctx, hostA.Addrs()[0])
	s.Require().NoError(err)

	// Bidirectional: both should see each other
	s.GreaterOrEqual(hostA.ConnectedPeerCount(), 1, "host A should see host B")
	s.GreaterOrEqual(hostB.ConnectedPeerCount(), 1, "host B should see host A")
	s.Contains(hostB.ConnectedPeers(), hostA.Host().ID())
	s.Contains(hostA.ConnectedPeers(), hostB.Host().ID())
}

// TestMDNSDiscovery verifies two hosts on the same project discover each other via mDNS.
// Uses retry with fresh hosts because multicast can be disrupted by prior host activity.
func (s *P2PDiscoverySuite) TestMDNSDiscovery() {
	if testing.Short() {
		s.T().Skip("skipping mDNS discovery in short mode")
	}

	project := fmt.Sprintf("mdns-proj-%d", time.Now().UnixNano())

	createMDNSHost := func(name string) (*P2PHost, *Store) {
		tmpDir := s.T().TempDir()
		ident, err := GenerateIdentity()
		s.Require().NoError(err)

		cfg := DefaultNodeConfig()
		cfg.Node.Name = name
		cfg.Node.Vertical = VerticalDev
		cfg.Node.Project = project
		cfg.Network.ListenPort = 0
		cfg.Network.EnableDHT = false
		cfg.Network.EnableMDNS = true

		store, err := NewStore(tmpDir + "/test.db")
		s.Require().NoError(err)

		host, err := NewP2PHost(context.Background(), ident, cfg, store)
		s.Require().NoError(err)

		return host, store
	}

	const maxAttempts = 5
	discovered := false
	var hostA, hostB *P2PHost

	for attempt := 0; attempt < maxAttempts && !discovered; attempt++ {
		if attempt > 0 {
			time.Sleep(2 * time.Second)
		}

		hA, stA := createMDNSHost(fmt.Sprintf("mdns-a-%d", attempt))
		hB, stB := createMDNSHost(fmt.Sprintf("mdns-b-%d", attempt))

		deadline := time.After(5 * time.Second)
		ticker := time.NewTicker(200 * time.Millisecond)

	poll:
		for {
			select {
			case <-deadline:
				ticker.Stop()
				hA.Close()
				stA.Close()
				hB.Close()
				stB.Close()
				break poll
			case <-ticker.C:
				if hA.ConnectedPeerCount() >= 1 && hB.ConnectedPeerCount() >= 1 {
					discovered = true
					hostA = hA
					hostB = hB
					s.T().Cleanup(func() {
						hA.Close()
						stA.Close()
						hB.Close()
						stB.Close()
					})
					ticker.Stop()
					break poll
				}
			}
		}
	}

	s.Require().True(discovered, "mDNS discovery failed after %d attempts", maxAttempts)
	s.Contains(hostA.ConnectedPeers(), hostB.Host().ID())
	s.Contains(hostB.ConnectedPeers(), hostA.Host().ID())
}

// TestMessageCacheIntegration verifies the P2PHost's internal cache works for replay protection.
func (s *P2PDiscoverySuite) TestMessageCacheIntegration() {
	host, _ := s.newHost("cache-node", "proj-cache", false)

	s.NotNil(host.cache)
	s.False(host.cache.IsSeen("msg-discovery-1"))
	host.cache.MarkSeen("msg-discovery-1")
	s.True(host.cache.IsSeen("msg-discovery-1"))

	s.True(host.cache.IsWithinWindow(time.Now()))
	s.False(host.cache.IsWithinWindow(time.Now().Add(-10 * time.Minute)),
		"10 minutes ago should be outside the 5-minute replay window")
}

// TestRateLimiterIntegration verifies the P2PHost's rate limiter is properly initialized.
func (s *P2PDiscoverySuite) TestRateLimiterIntegration() {
	// Create host with low rate limit for testability
	tmpDir := s.T().TempDir()
	ident, err := GenerateIdentity()
	s.Require().NoError(err)

	cfg := DefaultNodeConfig()
	cfg.Node.Name = "limiter-node"
	cfg.Node.Vertical = VerticalDev
	cfg.Node.Project = "proj-limiter"
	cfg.Network.ListenPort = 0
	cfg.Network.EnableDHT = false
	cfg.Network.EnableMDNS = false
	cfg.Security.MaxMessageRate = 3
	cfg.Security.ThrottleDuration = 10 * time.Second

	store, err := NewStore(tmpDir + "/test.db")
	s.Require().NoError(err)

	host, err := NewP2PHost(context.Background(), ident, cfg, store)
	s.Require().NoError(err)
	s.T().Cleanup(func() {
		host.Close()
		store.Close()
	})

	s.NotNil(host.limiter)

	// Should allow up to MaxMessageRate messages
	s.True(host.limiter.AllowMessage("peer-x"))
	s.True(host.limiter.AllowMessage("peer-x"))
	s.True(host.limiter.AllowMessage("peer-x"))
	// 4th should be blocked
	s.False(host.limiter.AllowMessage("peer-x"))
	s.True(host.limiter.IsThrottled("peer-x"))

	// Different peer is independent
	s.True(host.limiter.AllowMessage("peer-y"))
	s.False(host.limiter.IsThrottled("peer-y"))
}

// TestPeerRegistrationOnHandshake verifies that HandlePeerHandshake registers a
// connected peer in the local store.
func (s *P2PDiscoverySuite) TestPeerRegistrationOnHandshake() {
	hostA, storeA := s.newHost("node-a", "proj-handshake", false)
	hostB, _ := s.newHost("node-b", "proj-handshake", false)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Connect B to A
	err := hostB.ConnectPeer(ctx, hostA.Addrs()[0])
	s.Require().NoError(err)

	// Set up handlers on host A's side
	sm := NewStateMachine()
	prop := NewSignalPropagator(storeA, sm)
	crsm := NewCRStateMachine()
	engine := NewEngine(storeA, prop, crsm)
	bus := NewP2PEventBus()
	handlers := NewP2PHandlers(engine, storeA, bus)

	// Simulate handshake from B
	peerB := &Peer{
		PeerID:   hostB.PeerIDString(),
		NodeID:   "node-b-id",
		Name:     "node-b",
		Vertical: VerticalPM,
		Project:  "proj-handshake",
		Owner:    "owner-b",
		Status:   PeerStatusPending,
		Addrs:    hostB.ShareableAddrs(),
	}
	err = handlers.HandlePeerHandshake(ctx, peerB)
	s.Require().NoError(err)

	// Verify peer is stored
	gotPeer, err := storeA.GetPeer(ctx, hostB.PeerIDString())
	s.Require().NoError(err)
	s.NotNil(gotPeer)
	s.Equal(hostB.PeerIDString(), gotPeer.PeerID)
	s.Equal("node-b", gotPeer.Name)
	s.Equal(PeerStatusPending, gotPeer.Status)
	s.Equal("proj-handshake", gotPeer.Project)
}

// TestCloseCleanup verifies that closing a P2PHost prevents new connections.
func (s *P2PDiscoverySuite) TestCloseCleanup() {
	// Create host manually (not via newHost) to control close lifecycle
	tmpDir := s.T().TempDir()
	ident, err := GenerateIdentity()
	s.Require().NoError(err)

	cfg := DefaultNodeConfig()
	cfg.Node.Name = "close-node"
	cfg.Node.Vertical = VerticalDev
	cfg.Node.Project = "proj-close"
	cfg.Network.ListenPort = 0
	cfg.Network.EnableDHT = false
	cfg.Network.EnableMDNS = false

	store, err := NewStore(tmpDir + "/test.db")
	s.Require().NoError(err)
	defer store.Close()

	host, err := NewP2PHost(context.Background(), ident, cfg, store)
	s.Require().NoError(err)

	addrsBefore := host.Addrs()
	s.GreaterOrEqual(len(addrsBefore), 1)

	// Close the host
	s.Require().NoError(host.Close())

	// Create a second host and try to connect to the closed one
	host2, _ := s.newHost("live-node", "proj-close", false)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	err = host2.ConnectPeer(ctx, addrsBefore[0])
	s.Error(err, "connecting to a closed host should fail")
}

// TestShareableAddrs verifies addresses contain the peer ID in /p2p/ format.
func (s *P2PDiscoverySuite) TestShareableAddrs() {
	host, _ := s.newHost("addr-node", "proj-addrs", false)

	addrs := host.ShareableAddrs()
	s.GreaterOrEqual(len(addrs), 1)

	for _, addr := range addrs {
		s.Contains(addr, "/p2p/", "address should contain /p2p/ component")
		s.Contains(addr, host.PeerIDString(), "address should contain peer ID")
		s.Contains(addr, "/tcp/", "address should contain /tcp/ component")
		s.Contains(addr, "/ip4/", "address should contain /ip4/ component")
	}

	// Verify parseable as multiaddr
	_, err := multiaddr.NewMultiaddr(addrs[0])
	s.NoError(err, "address should be a valid multiaddr")
}
