package main

import (
	"context"
	"sync"
	"testing"

	"github.com/stretchr/testify/suite"
)

// =============================================================================
// PairingStoreSuite — Store-level CRUD tests for pairing_sessions
// =============================================================================

type PairingStoreSuite struct {
	suite.Suite
	store *Store
	ctx   context.Context
}

func (s *PairingStoreSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store
	s.ctx = context.Background()
}

func (s *PairingStoreSuite) TearDownTest() {
	s.store.Close()
}

func (s *PairingStoreSuite) TestCreateAndGetPairingSession() {
	ps := &PairingSession{
		HostPeerID:  "host-peer-1",
		HostNodeID:  "host-node-1",
		GuestPeerID: "guest-peer-1",
		GuestNodeID: "guest-node-1",
	}
	err := s.store.CreatePairingSession(s.ctx, ps)
	s.Require().NoError(err)
	s.NotEmpty(ps.ID)
	s.Equal(PairingPending, ps.Status)
	s.False(ps.StartedAt.IsZero())

	got, err := s.store.GetPairingSession(s.ctx, ps.ID)
	s.Require().NoError(err)
	s.Equal(ps.ID, got.ID)
	s.Equal("host-peer-1", got.HostPeerID)
	s.Equal("host-node-1", got.HostNodeID)
	s.Equal("guest-peer-1", got.GuestPeerID)
	s.Equal("guest-node-1", got.GuestNodeID)
	s.Equal(PairingPending, got.Status)
	s.Nil(got.EndedAt)
}

func (s *PairingStoreSuite) TestUpdatePairingSessionStatus() {
	ps := &PairingSession{
		HostPeerID:  "host-peer-1",
		HostNodeID:  "host-node-1",
		GuestPeerID: "guest-peer-1",
		GuestNodeID: "guest-node-1",
	}
	s.Require().NoError(s.store.CreatePairingSession(s.ctx, ps))

	err := s.store.UpdatePairingSessionStatus(s.ctx, ps.ID, PairingActive)
	s.Require().NoError(err)

	got, err := s.store.GetPairingSession(s.ctx, ps.ID)
	s.Require().NoError(err)
	s.Equal(PairingActive, got.Status)
}

func (s *PairingStoreSuite) TestEndPairingSession() {
	ps := &PairingSession{
		HostPeerID:  "host-peer-1",
		HostNodeID:  "host-node-1",
		GuestPeerID: "guest-peer-1",
		GuestNodeID: "guest-node-1",
	}
	s.Require().NoError(s.store.CreatePairingSession(s.ctx, ps))
	s.Require().NoError(s.store.UpdatePairingSessionStatus(s.ctx, ps.ID, PairingActive))

	err := s.store.EndPairingSession(s.ctx, ps.ID)
	s.Require().NoError(err)

	got, err := s.store.GetPairingSession(s.ctx, ps.ID)
	s.Require().NoError(err)
	s.Equal(PairingEnded, got.Status)
	s.NotNil(got.EndedAt)
}

func (s *PairingStoreSuite) TestListActivePairingSessions() {
	// Create three sessions: one active as host, one active as guest, one pending
	ps1 := &PairingSession{
		HostPeerID: "peer-A", HostNodeID: "node-A",
		GuestPeerID: "peer-B", GuestNodeID: "node-B",
	}
	s.Require().NoError(s.store.CreatePairingSession(s.ctx, ps1))
	s.Require().NoError(s.store.UpdatePairingSessionStatus(s.ctx, ps1.ID, PairingActive))

	ps2 := &PairingSession{
		HostPeerID: "peer-C", HostNodeID: "node-C",
		GuestPeerID: "peer-A", GuestNodeID: "node-A",
	}
	s.Require().NoError(s.store.CreatePairingSession(s.ctx, ps2))
	s.Require().NoError(s.store.UpdatePairingSessionStatus(s.ctx, ps2.ID, PairingActive))

	ps3 := &PairingSession{
		HostPeerID: "peer-A", HostNodeID: "node-A",
		GuestPeerID: "peer-D", GuestNodeID: "node-D",
	}
	s.Require().NoError(s.store.CreatePairingSession(s.ctx, ps3))
	// ps3 stays pending

	sessions, err := s.store.ListActivePairingSessions(s.ctx, "peer-A")
	s.Require().NoError(err)
	s.Len(sessions, 2) // ps1 (host) and ps2 (guest), not ps3 (pending)
}

func (s *PairingStoreSuite) TestGetActivePairingBetween() {
	ps := &PairingSession{
		HostPeerID: "host-1", HostNodeID: "node-h",
		GuestPeerID: "guest-1", GuestNodeID: "node-g",
	}
	s.Require().NoError(s.store.CreatePairingSession(s.ctx, ps))
	s.Require().NoError(s.store.UpdatePairingSessionStatus(s.ctx, ps.ID, PairingActive))

	// Found
	got, err := s.store.GetActivePairingBetween(s.ctx, "host-1", "guest-1")
	s.Require().NoError(err)
	s.NotNil(got)
	s.Equal(ps.ID, got.ID)

	// Not found (reversed direction)
	got, err = s.store.GetActivePairingBetween(s.ctx, "guest-1", "host-1")
	s.Require().NoError(err)
	s.Nil(got)

	// Not found (nonexistent)
	got, err = s.store.GetActivePairingBetween(s.ctx, "unknown", "unknown2")
	s.Require().NoError(err)
	s.Nil(got)
}

func TestPairingStoreSuite(t *testing.T) {
	suite.Run(t, new(PairingStoreSuite))
}

// =============================================================================
// PairingEngineSuite — Engine-level pairing tests
// =============================================================================

type PairingEngineSuite struct {
	suite.Suite
	store  *Store
	engine *Engine
	ctx    context.Context
}

func (s *PairingEngineSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store
	s.engine = NewEngine(store, NewSignalPropagator(store, NewStateMachine()), NewCRStateMachine())
	s.ctx = context.Background()
}

func (s *PairingEngineSuite) TearDownTest() {
	s.store.Close()
}

func (s *PairingEngineSuite) TestInvitePair() {
	ps, err := s.engine.InvitePair(s.ctx, "host-peer", "host-node", "guest-peer", "guest-node")
	s.Require().NoError(err)
	s.NotEmpty(ps.ID)
	s.Equal(PairingPending, ps.Status)
	s.Equal("host-peer", ps.HostPeerID)
	s.Equal("guest-peer", ps.GuestPeerID)
}

func (s *PairingEngineSuite) TestInvitePairDuplicateRejected() {
	// Create and accept first session (becomes active)
	ps1, err := s.engine.InvitePair(s.ctx, "host-peer", "host-node", "guest-peer", "guest-node")
	s.Require().NoError(err)
	_, err = s.engine.AcceptPair(s.ctx, ps1.ID, "guest-peer")
	s.Require().NoError(err)

	// Create a second pending session (same pair)
	ps2, err := s.engine.InvitePair(s.ctx, "host-peer", "host-node", "guest-peer", "guest-node")
	s.Require().NoError(err)

	// The pending session should NOT appear in active list
	active, err := s.engine.ListPairingSessions(s.ctx, "host-peer")
	s.Require().NoError(err)
	for _, sess := range active {
		s.NotEqual(ps2.ID, sess.ID, "pending duplicate should not appear in active list")
	}
}

func (s *PairingEngineSuite) TestAcceptPair() {
	ps, err := s.engine.InvitePair(s.ctx, "host-peer", "host-node", "guest-peer", "guest-node")
	s.Require().NoError(err)

	accepted, err := s.engine.AcceptPair(s.ctx, ps.ID, "guest-peer")
	s.Require().NoError(err)
	s.Equal(PairingActive, accepted.Status)
}

func (s *PairingEngineSuite) TestAcceptPairWrongGuest() {
	ps, err := s.engine.InvitePair(s.ctx, "host-peer", "host-node", "guest-peer", "guest-node")
	s.Require().NoError(err)

	_, err = s.engine.AcceptPair(s.ctx, ps.ID, "wrong-peer")
	s.Error(err)
	s.Contains(err.Error(), "not the invited guest")
}

func (s *PairingEngineSuite) TestAcceptPairNotPending() {
	ps, err := s.engine.InvitePair(s.ctx, "host-peer", "host-node", "guest-peer", "guest-node")
	s.Require().NoError(err)

	// Accept once
	_, err = s.engine.AcceptPair(s.ctx, ps.ID, "guest-peer")
	s.Require().NoError(err)

	// Try to accept again (now active, not pending)
	_, err = s.engine.AcceptPair(s.ctx, ps.ID, "guest-peer")
	s.Error(err)
	s.Contains(err.Error(), "not pending")
}

func (s *PairingEngineSuite) TestEndPair() {
	ps, err := s.engine.InvitePair(s.ctx, "host-peer", "host-node", "guest-peer", "guest-node")
	s.Require().NoError(err)
	_, err = s.engine.AcceptPair(s.ctx, ps.ID, "guest-peer")
	s.Require().NoError(err)

	ended, err := s.engine.EndPair(s.ctx, ps.ID, "host-peer")
	s.Require().NoError(err)
	s.Equal(PairingEnded, ended.Status)
	s.NotNil(ended.EndedAt)
}

func (s *PairingEngineSuite) TestEndPairByGuest() {
	ps, err := s.engine.InvitePair(s.ctx, "host-peer", "host-node", "guest-peer", "guest-node")
	s.Require().NoError(err)
	_, err = s.engine.AcceptPair(s.ctx, ps.ID, "guest-peer")
	s.Require().NoError(err)

	ended, err := s.engine.EndPair(s.ctx, ps.ID, "guest-peer")
	s.Require().NoError(err)
	s.Equal(PairingEnded, ended.Status)
	s.NotNil(ended.EndedAt)
}

func (s *PairingEngineSuite) TestEndPairByUnrelated() {
	ps, err := s.engine.InvitePair(s.ctx, "host-peer", "host-node", "guest-peer", "guest-node")
	s.Require().NoError(err)
	_, err = s.engine.AcceptPair(s.ctx, ps.ID, "guest-peer")
	s.Require().NoError(err)

	_, err = s.engine.EndPair(s.ctx, ps.ID, "unrelated-peer")
	s.Error(err)
	s.Contains(err.Error(), "not a participant")
}

func (s *PairingEngineSuite) TestListPairingSessions() {
	// Create two sessions, activate both
	ps1, err := s.engine.InvitePair(s.ctx, "host-peer", "host-node", "guest-1", "gnode-1")
	s.Require().NoError(err)
	_, err = s.engine.AcceptPair(s.ctx, ps1.ID, "guest-1")
	s.Require().NoError(err)

	ps2, err := s.engine.InvitePair(s.ctx, "host-peer", "host-node", "guest-2", "gnode-2")
	s.Require().NoError(err)
	_, err = s.engine.AcceptPair(s.ctx, ps2.ID, "guest-2")
	s.Require().NoError(err)

	// Create a third session but leave it pending
	_, err = s.engine.InvitePair(s.ctx, "host-peer", "host-node", "guest-3", "gnode-3")
	s.Require().NoError(err)

	// End one
	_, err = s.engine.EndPair(s.ctx, ps1.ID, "host-peer")
	s.Require().NoError(err)

	// List: only ps2 should be active
	active, err := s.engine.ListPairingSessions(s.ctx, "host-peer")
	s.Require().NoError(err)
	s.Len(active, 1)
	s.Equal(ps2.ID, active[0].ID)
}

func TestPairingEngineSuite(t *testing.T) {
	suite.Run(t, new(PairingEngineSuite))
}

// =============================================================================
// PairingHandlerSuite — P2P handler tests for pairing messages
// =============================================================================

type PairingHandlerSuite struct {
	suite.Suite
	store      *Store
	engine     *Engine
	handlers   *P2PHandlers
	dispatcher *P2PEventBus
	events     []P2PEvent
	mu         sync.Mutex
	ctx        context.Context
}

func (s *PairingHandlerSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store
	s.engine = NewEngine(store, NewSignalPropagator(store, NewStateMachine()), NewCRStateMachine())
	s.dispatcher = NewP2PEventBus()
	s.handlers = NewP2PHandlers(s.engine, store, s.dispatcher)
	s.events = nil
	s.ctx = context.Background()

	s.dispatcher.Register(func(_ context.Context, event P2PEvent) {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.events = append(s.events, event)
	})
}

func (s *PairingHandlerSuite) TearDownTest() {
	s.store.Close()
}

func (s *PairingHandlerSuite) collectedEvents() []P2PEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := make([]P2PEvent, len(s.events))
	copy(cp, s.events)
	return cp
}

func (s *PairingHandlerSuite) TestHandlePairInvite() {
	ps, err := s.handlers.HandlePairInvite(s.ctx, "sess-1", "host-peer", "host-node", "guest-peer", "guest-node")
	s.Require().NoError(err)
	s.Equal("sess-1", ps.ID)
	s.Equal(PairingPending, ps.Status)
	s.Equal("host-peer", ps.HostPeerID)
	s.Equal("guest-peer", ps.GuestPeerID)

	// Verify it was persisted
	got, err := s.store.GetPairingSession(s.ctx, "sess-1")
	s.Require().NoError(err)
	s.Equal("sess-1", got.ID)

	// Verify dispatched event
	evts := s.collectedEvents()
	s.Require().Len(evts, 1)
	s.Equal(P2PPairInviteReceived, evts[0].Type)
	payload, ok := evts[0].Payload.(PairingEventPayload)
	s.True(ok)
	s.Equal("sess-1", payload.Session.ID)
}

func (s *PairingHandlerSuite) TestHandlePairAccept() {
	// Create a pending session first
	_, err := s.handlers.HandlePairInvite(s.ctx, "sess-2", "host-peer", "host-node", "guest-peer", "guest-node")
	s.Require().NoError(err)

	// Accept
	ps, err := s.handlers.HandlePairAccept(s.ctx, "sess-2", "guest-peer")
	s.Require().NoError(err)
	s.Equal(PairingActive, ps.Status)

	// Verify dispatched events: invite + accept
	evts := s.collectedEvents()
	s.Require().Len(evts, 2)
	s.Equal(P2PPairAccepted, evts[1].Type)
	payload, ok := evts[1].Payload.(PairingEventPayload)
	s.True(ok)
	s.Equal(PairingActive, payload.Session.Status)

	// Verify wrong guest is rejected
	_, err = s.handlers.HandlePairInvite(s.ctx, "sess-3", "host-peer", "host-node", "guest-peer-2", "guest-node-2")
	s.Require().NoError(err)
	_, err = s.handlers.HandlePairAccept(s.ctx, "sess-3", "wrong-peer")
	s.Error(err)
	s.Contains(err.Error(), "not the invited guest")
}

func (s *PairingHandlerSuite) TestHandlePairEnd() {
	// Create and accept a session
	_, err := s.handlers.HandlePairInvite(s.ctx, "sess-4", "host-peer", "host-node", "guest-peer", "guest-node")
	s.Require().NoError(err)
	_, err = s.handlers.HandlePairAccept(s.ctx, "sess-4", "guest-peer")
	s.Require().NoError(err)

	// End by host
	ps, err := s.handlers.HandlePairEnd(s.ctx, "sess-4", "host-peer")
	s.Require().NoError(err)
	s.Equal(PairingEnded, ps.Status)
	s.NotNil(ps.EndedAt)

	// Verify dispatched events: invite + accept + end
	evts := s.collectedEvents()
	s.Require().Len(evts, 3)
	s.Equal(P2PPairEnded, evts[2].Type)

	// Verify non-participant is rejected
	_, err = s.handlers.HandlePairInvite(s.ctx, "sess-5", "host-peer", "host-node", "guest-peer", "guest-node")
	s.Require().NoError(err)
	_, err = s.handlers.HandlePairAccept(s.ctx, "sess-5", "guest-peer")
	s.Require().NoError(err)
	_, err = s.handlers.HandlePairEnd(s.ctx, "sess-5", "unrelated-peer")
	s.Error(err)
	s.Contains(err.Error(), "not a participant")
}

func TestPairingHandlerSuite(t *testing.T) {
	suite.Run(t, new(PairingHandlerSuite))
}

// =============================================================================
// PairingBridgeSuite — Event forwarding bridge tests
// =============================================================================

type sentEvent struct {
	SessionID   string
	ToPeerID    string
	EventKind   string
	PayloadJSON string
}

type PairingBridgeSuite struct {
	suite.Suite
	store  *Store
	bus    *P2PEventBus
	bridge *PairingBridge
	sent   []sentEvent
	mu     sync.Mutex
	ctx    context.Context
}

func (s *PairingBridgeSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store
	s.bus = NewP2PEventBus()
	s.sent = nil
	s.ctx = context.Background()

	s.bridge = NewPairingBridge(store, "host-peer", func(_ context.Context, sessionID, toPeerID, eventKind, payloadJSON string) {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.sent = append(s.sent, sentEvent{
			SessionID:   sessionID,
			ToPeerID:    toPeerID,
			EventKind:   eventKind,
			PayloadJSON: payloadJSON,
		})
	})
	s.bridge.Register(s.bus)
}

func (s *PairingBridgeSuite) TearDownTest() {
	s.store.Close()
}

func (s *PairingBridgeSuite) sentEvents() []sentEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := make([]sentEvent, len(s.sent))
	copy(cp, s.sent)
	return cp
}

func (s *PairingBridgeSuite) TestBridgeForwardsEventsToGuest() {
	// Create an active pairing session where host-peer is the host
	ps := &PairingSession{
		HostPeerID:  "host-peer",
		HostNodeID:  "host-node",
		GuestPeerID: "guest-peer",
		GuestNodeID: "guest-node",
	}
	s.Require().NoError(s.store.CreatePairingSession(s.ctx, ps))
	s.Require().NoError(s.store.UpdatePairingSessionStatus(s.ctx, ps.ID, PairingActive))

	// Dispatch a non-pairing event
	s.bus.Dispatch(s.ctx, P2PEvent{
		Type:    P2PSignalReceived,
		Payload: SignalEventPayload{SourceItemID: "item-1", SourceNodeID: "node-1", TargetItemID: "item-2", Reason: "changed"},
	})

	evts := s.sentEvents()
	s.Require().Len(evts, 1)
	s.Equal(ps.ID, evts[0].SessionID)
	s.Equal("guest-peer", evts[0].ToPeerID)
	s.Equal(string(P2PSignalReceived), evts[0].EventKind)
	s.Contains(evts[0].PayloadJSON, "item-1")
}

func (s *PairingBridgeSuite) TestBridgeDoesNotForwardWhenNoPairing() {
	// No active sessions exist — dispatch an event
	s.bus.Dispatch(s.ctx, P2PEvent{
		Type:    P2PQueryReceived,
		Payload: QueryEventPayload{QueryID: "q-1", AskerID: "asker", Question: "why?"},
	})

	evts := s.sentEvents()
	s.Len(evts, 0)
}

func (s *PairingBridgeSuite) TestBridgeDoesNotForwardPairingEvents() {
	// Create an active pairing session
	ps := &PairingSession{
		HostPeerID:  "host-peer",
		HostNodeID:  "host-node",
		GuestPeerID: "guest-peer",
		GuestNodeID: "guest-node",
	}
	s.Require().NoError(s.store.CreatePairingSession(s.ctx, ps))
	s.Require().NoError(s.store.UpdatePairingSessionStatus(s.ctx, ps.ID, PairingActive))

	// Dispatch pairing events — these should be skipped to avoid loops
	s.bus.Dispatch(s.ctx, P2PEvent{
		Type:    P2PPairInviteReceived,
		Payload: PairingEventPayload{Session: ps},
	})
	s.bus.Dispatch(s.ctx, P2PEvent{
		Type:    P2PPairAccepted,
		Payload: PairingEventPayload{Session: ps},
	})
	s.bus.Dispatch(s.ctx, P2PEvent{
		Type:    P2PPairEnded,
		Payload: PairingEventPayload{Session: ps},
	})

	evts := s.sentEvents()
	s.Len(evts, 0, "pairing events should not be forwarded")
}

func TestPairingBridgeSuite(t *testing.T) {
	suite.Run(t, new(PairingBridgeSuite))
}

// =============================================================================
// PairingScenarioSuite — End-to-end pairing scenario tests
// =============================================================================

type PairingScenarioSuite struct {
	suite.Suite
	store  *Store
	engine *Engine
	ctx    context.Context
}

func TestPairingScenarioSuite(t *testing.T) {
	suite.Run(t, new(PairingScenarioSuite))
}

func (s *PairingScenarioSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store
	s.ctx = context.Background()
	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	s.engine = NewEngine(store, prop, crsm)
}

func (s *PairingScenarioSuite) TearDownTest() {
	s.store.Close()
}

// TestPMDesignerPairingWorkflow exercises a full PM → Dev pairing lifecycle:
// register nodes, create/verify items, invite/accept/end pairing, add cross-node
// trace, and verify audit shows no missing upstream refs for the traced ADR.
func (s *PairingScenarioSuite) TestPMDesignerPairingWorkflow() {
	ctx := s.ctx

	// 1. Register PM and Dev nodes
	pmNode, err := s.engine.RegisterNode(ctx, "pm-inv", VerticalPM, "project-x", "alice", false)
	s.Require().NoError(err)
	devNode, err := s.engine.RegisterNode(ctx, "dev-inv", VerticalDev, "project-x", "bob", false)
	s.Require().NoError(err)

	// 2. PM creates and verifies a user story
	story, err := s.engine.AddItem(ctx, pmNode.ID, KindUserStory, "Login flow", "User can login with email", "")
	s.Require().NoError(err)
	err = s.engine.VerifyItem(ctx, story.ID, "acceptance criteria reviewed", "alice")
	s.Require().NoError(err)

	// 3. PM invites Dev to pair → pending session
	ps, err := s.engine.InvitePair(ctx, "pm-peer", pmNode.ID, "dev-peer", devNode.ID)
	s.Require().NoError(err)
	s.Equal(PairingPending, ps.Status)

	// 4. Dev accepts → active session
	accepted, err := s.engine.AcceptPair(ctx, ps.ID, "dev-peer")
	s.Require().NoError(err)
	s.Equal(PairingActive, accepted.Status)

	// 5. Dev creates ADR and traces it to PM's user story
	adr, err := s.engine.AddItem(ctx, devNode.ID, KindADR, "Auth ADR", "WebSocket auth handler", "")
	s.Require().NoError(err)
	trace, err := s.engine.AddTrace(ctx, adr.ID, story.ID, RelationTracedFrom, "bob")
	s.Require().NoError(err)

	// 6. Verify cross-node trace exists
	s.Equal(adr.ID, trace.FromItemID)
	s.Equal(story.ID, trace.ToItemID)
	s.Equal(devNode.ID, trace.FromNodeID)
	s.Equal(pmNode.ID, trace.ToNodeID)

	traces, err := s.engine.GetItemTraces(ctx, adr.ID)
	s.Require().NoError(err)
	s.Len(traces, 1)
	s.Equal(RelationTracedFrom, traces[0].Relation)

	// 7. PM ends pairing → ended session
	ended, err := s.engine.EndPair(ctx, ps.ID, "pm-peer")
	s.Require().NoError(err)
	s.Equal(PairingEnded, ended.Status)
	s.NotNil(ended.EndedAt)

	// 8. Audit dev node → adr should NOT have missing upstream refs
	report, err := s.engine.Audit(ctx, devNode.ID)
	s.Require().NoError(err)
	for _, missingID := range report.MissingUpstreamRefs {
		s.NotEqual(adr.ID, missingID, "ADR with upstream trace should not appear in MissingUpstreamRefs")
	}
}

// TestMultipleConcurrentPairings verifies that multiple pairing sessions can
// coexist and that ending one does not affect the other.
func (s *PairingScenarioSuite) TestMultipleConcurrentPairings() {
	ctx := s.ctx

	// 1. PM invites Designer and Dev separately
	ps1, err := s.engine.InvitePair(ctx, "pm-peer", "pm-node", "designer-peer", "designer-node")
	s.Require().NoError(err)
	ps2, err := s.engine.InvitePair(ctx, "pm-peer", "pm-node", "dev-peer", "dev-node")
	s.Require().NoError(err)

	// 2. Both accept → 2 active sessions
	_, err = s.engine.AcceptPair(ctx, ps1.ID, "designer-peer")
	s.Require().NoError(err)
	_, err = s.engine.AcceptPair(ctx, ps2.ID, "dev-peer")
	s.Require().NoError(err)

	// 3. Verify ListPairingSessions returns 2
	active, err := s.engine.ListPairingSessions(ctx, "pm-peer")
	s.Require().NoError(err)
	s.Len(active, 2)

	// 4. End one → verify only 1 active remains
	_, err = s.engine.EndPair(ctx, ps1.ID, "pm-peer")
	s.Require().NoError(err)

	active, err = s.engine.ListPairingSessions(ctx, "pm-peer")
	s.Require().NoError(err)
	s.Len(active, 1)
	s.Equal(ps2.ID, active[0].ID)
}

// TestBridgeIntegration verifies the PairingBridge lifecycle: no forwarding
// before pairing, forwarding during active pairing, no forwarding after ending.
func (s *PairingScenarioSuite) TestBridgeIntegration() {
	ctx := s.ctx

	// 1. Create PairingBridge with mock send function that records forwarded messages
	var mu sync.Mutex
	var forwarded []sentEvent
	bus := NewP2PEventBus()
	bridge := NewPairingBridge(s.store, "host-peer", func(_ context.Context, sessionID, toPeerID, eventKind, payloadJSON string) {
		mu.Lock()
		defer mu.Unlock()
		forwarded = append(forwarded, sentEvent{
			SessionID:   sessionID,
			ToPeerID:    toPeerID,
			EventKind:   eventKind,
			PayloadJSON: payloadJSON,
		})
	})
	bridge.Register(bus)

	countForwarded := func() int {
		mu.Lock()
		defer mu.Unlock()
		return len(forwarded)
	}

	// 2. Before pairing: dispatch event → no forwarding
	bus.Dispatch(ctx, P2PEvent{
		Type:    P2PSignalReceived,
		Payload: SignalEventPayload{SourceItemID: "item-1", SourceNodeID: "node-1", TargetItemID: "item-2", Reason: "changed"},
	})
	s.Equal(0, countForwarded(), "no forwarding before pairing")

	// 3. Create and activate pairing session in store
	ps := &PairingSession{
		HostPeerID:  "host-peer",
		HostNodeID:  "host-node",
		GuestPeerID: "guest-peer",
		GuestNodeID: "guest-node",
	}
	s.Require().NoError(s.store.CreatePairingSession(ctx, ps))
	s.Require().NoError(s.store.UpdatePairingSessionStatus(ctx, ps.ID, PairingActive))

	// 4. During pairing: dispatch P2PSignalReceived event → forwarded to guest
	bus.Dispatch(ctx, P2PEvent{
		Type:    P2PSignalReceived,
		Payload: SignalEventPayload{SourceItemID: "item-3", SourceNodeID: "node-3", TargetItemID: "item-4", Reason: "updated"},
	})
	s.Equal(1, countForwarded(), "event forwarded during active pairing")

	// Check toPeerID and eventKind
	mu.Lock()
	last := forwarded[len(forwarded)-1]
	mu.Unlock()
	s.Equal("guest-peer", last.ToPeerID)
	s.Equal(string(P2PSignalReceived), last.EventKind)

	// 5. End pairing session in store
	s.Require().NoError(s.store.EndPairingSession(ctx, ps.ID))

	// 6. After ending: dispatch event → no forwarding (count stays same)
	bus.Dispatch(ctx, P2PEvent{
		Type:    P2PSignalReceived,
		Payload: SignalEventPayload{SourceItemID: "item-5", SourceNodeID: "node-5", TargetItemID: "item-6", Reason: "deleted"},
	})
	s.Equal(1, countForwarded(), "no forwarding after pairing ended")
}

// TestSessionStatusIncludesPairings verifies that active pairing sessions are
// returned by ListActivePairingSessions after being created and activated.
func (s *PairingScenarioSuite) TestSessionStatusIncludesPairings() {
	ctx := s.ctx

	// 1. Register a node
	node, err := s.engine.RegisterNode(ctx, "dev-inv", VerticalDev, "project-x", "cuong", false)
	s.Require().NoError(err)

	// 2. Create and activate a pairing session
	ps := &PairingSession{
		HostPeerID:  "host-peer",
		HostNodeID:  node.ID,
		GuestPeerID: "guest-peer",
		GuestNodeID: "guest-node",
	}
	s.Require().NoError(s.store.CreatePairingSession(ctx, ps))
	s.Require().NoError(s.store.UpdatePairingSessionStatus(ctx, ps.ID, PairingActive))

	// 3. Verify ListActivePairingSessions returns it
	sessions, err := s.store.ListActivePairingSessions(ctx, "host-peer")
	s.Require().NoError(err)
	s.Require().Len(sessions, 1)
	s.Equal(ps.ID, sessions[0].ID)
	s.Equal(PairingActive, sessions[0].Status)
	s.Equal("host-peer", sessions[0].HostPeerID)
	s.Equal("guest-peer", sessions[0].GuestPeerID)
}
