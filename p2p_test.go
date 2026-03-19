package main

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/suite"
)

type P2PSuite struct {
	suite.Suite
}

func (s *P2PSuite) TestNewP2PHost_StartsAndStops() {
	tmpDir := s.T().TempDir()
	ident, err := GenerateIdentity()
	s.Require().NoError(err)

	cfg := DefaultNodeConfig()
	cfg.Node.Name = "test-node"
	cfg.Node.Vertical = VerticalDev
	cfg.Node.Project = "test-project"
	cfg.Node.Owner = "tester"
	cfg.Network.ListenPort = 0 // Random port
	cfg.Network.EnableDHT = false
	cfg.Network.EnableMDNS = false

	store, err := NewStore(tmpDir + "/test.db")
	s.Require().NoError(err)
	defer store.Close()

	host, err := NewP2PHost(context.Background(), ident, cfg, store)
	s.Require().NoError(err)
	s.NotNil(host)
	s.NotEmpty(host.Addrs())

	err = host.Close()
	s.NoError(err)
}

func (s *P2PSuite) TestTwoHosts_Connect() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	tmpDir1 := s.T().TempDir()
	tmpDir2 := s.T().TempDir()

	ident1, _ := GenerateIdentity()
	ident2, _ := GenerateIdentity()

	cfg1 := DefaultNodeConfig()
	cfg1.Node.Name = "node-1"
	cfg1.Node.Vertical = VerticalDev
	cfg1.Node.Project = "test-project"
	cfg1.Node.Owner = "owner-1"
	cfg1.Network.ListenPort = 0
	cfg1.Network.EnableDHT = false
	cfg1.Network.EnableMDNS = false

	cfg2 := DefaultNodeConfig()
	cfg2.Node.Name = "node-2"
	cfg2.Node.Vertical = VerticalPM
	cfg2.Node.Project = "test-project"
	cfg2.Node.Owner = "owner-2"
	cfg2.Network.ListenPort = 0
	cfg2.Network.EnableDHT = false
	cfg2.Network.EnableMDNS = false

	store1, _ := NewStore(tmpDir1 + "/test1.db")
	defer store1.Close()
	store2, _ := NewStore(tmpDir2 + "/test2.db")
	defer store2.Close()

	host1, err := NewP2PHost(ctx, ident1, cfg1, store1)
	s.Require().NoError(err)
	defer host1.Close()

	host2, err := NewP2PHost(ctx, ident2, cfg2, store2)
	s.Require().NoError(err)
	defer host2.Close()

	// Connect host2 to host1
	err = host2.ConnectPeer(ctx, host1.Addrs()[0])
	s.Require().NoError(err)

	// Verify connected
	peers := host2.ConnectedPeers()
	s.GreaterOrEqual(len(peers), 1)
}

func (s *P2PSuite) TestP2PHost_PeerID() {
	ident, _ := GenerateIdentity()
	cfg := DefaultNodeConfig()
	cfg.Network.ListenPort = 0
	cfg.Network.EnableDHT = false
	cfg.Network.EnableMDNS = false

	tmpDir := s.T().TempDir()
	store, _ := NewStore(tmpDir + "/test.db")
	defer store.Close()

	host, err := NewP2PHost(context.Background(), ident, cfg, store)
	s.Require().NoError(err)
	defer host.Close()

	s.Equal(ident.PeerID.String(), host.PeerIDString())
}

func (s *P2PSuite) TestP2PSender_QueueToOutbox() {
	tmpDir := s.T().TempDir()
	store, err := NewStore(tmpDir + "/test.db")
	s.Require().NoError(err)
	defer store.Close()

	sender := NewP2PSender(nil, store) // nil host = offline mode

	err = sender.SendEnvelope(context.Background(), "target-peer", []byte("test-envelope"))
	s.Require().NoError(err)

	// Should be in outbox since host is nil
	msgs, err := store.GetPendingOutbox(context.Background(), "target-peer", 10)
	s.Require().NoError(err)
	s.Len(msgs, 1)
	s.Equal("test-envelope", string(msgs[0].Envelope))
}

func (s *P2PSuite) TestP2PSender_BroadcastQueuesForAllPeers() {
	tmpDir := s.T().TempDir()
	store, err := NewStore(tmpDir + "/test.db")
	s.Require().NoError(err)
	defer store.Close()

	ctx := context.Background()

	// Add two peers
	store.CreatePeer(ctx, &Peer{PeerID: "peer-1", NodeID: "n1", Name: "p1", Vertical: VerticalDev, Project: "proj", Owner: "o1", Status: PeerStatusApproved})
	store.CreatePeer(ctx, &Peer{PeerID: "peer-2", NodeID: "n2", Name: "p2", Vertical: VerticalPM, Project: "proj", Owner: "o2", Status: PeerStatusApproved})

	sender := NewP2PSender(nil, store)
	err = sender.BroadcastEnvelope(ctx, "proj", "self-peer", []byte("broadcast-data"))
	s.Require().NoError(err)

	msgs1, _ := store.GetPendingOutbox(ctx, "peer-1", 10)
	msgs2, _ := store.GetPendingOutbox(ctx, "peer-2", 10)
	s.Len(msgs1, 1)
	s.Len(msgs2, 1)
}

func (s *P2PSuite) TestP2PHandlers_HandleSignalChange() {
	tmpDir := s.T().TempDir()
	store, err := NewStore(tmpDir + "/test.db")
	s.Require().NoError(err)
	defer store.Close()

	ctx := context.Background()

	// Create a node and items
	node := &Node{Name: "dev", Vertical: VerticalDev, Project: "proj", Owner: "owner"}
	store.CreateNode(ctx, node)
	item := &Item{NodeID: node.ID, Kind: KindADR, Title: "Target Item", Body: "body"}
	store.CreateItem(ctx, item)

	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	engine := NewEngine(store, prop, crsm)

	handlers := NewP2PHandlers(engine, store, nil)

	err = handlers.HandleSignalChange(ctx, "remote-item", "remote-node", item.ID, "upstream changed")
	s.Require().NoError(err)
}

func (s *P2PSuite) TestP2PHandlers_HandleTraceResolve() {
	tmpDir := s.T().TempDir()
	store, err := NewStore(tmpDir + "/test.db")
	s.Require().NoError(err)
	defer store.Close()

	ctx := context.Background()

	node := &Node{Name: "dev", Vertical: VerticalDev, Project: "proj", Owner: "owner"}
	store.CreateNode(ctx, node)
	item := &Item{NodeID: node.ID, Kind: KindADR, Title: "My Item", Body: "body"}
	store.CreateItem(ctx, item)

	// Verify the item so it has a status
	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	engine := NewEngine(store, prop, crsm)
	engine.VerifyItem(ctx, item.ID, "proof", "tester")

	handlers := NewP2PHandlers(engine, store, nil)

	resp, err := handlers.HandleTraceResolve(ctx, item.ID)
	s.Require().NoError(err)
	s.True(resp.Found)
	s.Equal("My Item", resp.Title)
	s.Equal(string(KindADR), resp.Kind)
	s.Equal(string(StatusProven), resp.Status)
}

func (s *P2PSuite) TestP2PHandlers_HandleTraceResolve_NotFound() {
	tmpDir := s.T().TempDir()
	store, err := NewStore(tmpDir + "/test.db")
	s.Require().NoError(err)
	defer store.Close()

	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	engine := NewEngine(store, prop, crsm)

	handlers := NewP2PHandlers(engine, store, nil)

	resp, err := handlers.HandleTraceResolve(context.Background(), "nonexistent-id")
	s.Require().NoError(err)
	s.False(resp.Found)
}

func TestP2PSuite(t *testing.T) {
	suite.Run(t, new(P2PSuite))
}
