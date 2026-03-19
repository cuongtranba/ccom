package main

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/suite"
)

// EndToEndSuite exercises ALL features in a single continuous flow.
// State builds up across phases — items created in Phase 2 are traced in Phase 3,
// verified in Phase 4, broken in Phase 5, challenged in Phase 8, etc.
type EndToEndSuite struct {
	suite.Suite

	store        *Store
	engine       *Engine
	proposalEng  *ProposalEngine
	challengeEng *ChallengeEngine
	p2pBus       *P2PEventBus
	p2pHandlers  *P2PHandlers
	dispatcher   *EventDispatcher
	bridge       *PairingBridge

	// Security
	msgCache    *MessageCache
	rateLimiter *PeerRateLimiter

	// Captured events
	p2pEvents    []P2PEvent
	bridgeSent   []sentEvent
	mu           sync.Mutex

	// Nodes
	pmNode  *Node
	devNode *Node
	qaNode  *Node

	// Peer IDs
	pmPeerID  string
	devPeerID string
	qaPeerID  string

	ctx    context.Context
	tmpDir string
}

func TestEndToEndSuite(t *testing.T) {
	suite.Run(t, new(EndToEndSuite))
}

func (s *EndToEndSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store
	s.ctx = context.Background()

	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	s.engine = NewEngine(store, prop, crsm)
	s.proposalEng = NewProposalEngine(store)
	s.challengeEng = NewChallengeEngine(store, s.proposalEng)

	s.p2pBus = NewP2PEventBus()
	s.p2pBus.Register(func(_ context.Context, event P2PEvent) {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.p2pEvents = append(s.p2pEvents, event)
	})
	s.p2pHandlers = NewP2PHandlers(s.engine, store, s.p2pBus)

	logger := zerolog.Nop()
	s.dispatcher = NewEventDispatcher(store, logger)

	s.pmPeerID = "pm-peer"
	s.devPeerID = "dev-peer"
	s.qaPeerID = "qa-peer"

	s.bridge = NewPairingBridge(store, s.pmPeerID, func(_ context.Context, sessionID, toPeerID, eventKind, payloadJSON string) {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.bridgeSent = append(s.bridgeSent, sentEvent{
			SessionID:   sessionID,
			ToPeerID:    toPeerID,
			EventKind:   eventKind,
			PayloadJSON: payloadJSON,
		})
	})
	s.bridge.Register(s.p2pBus)

	s.msgCache = NewMessageCache(1000, 5*time.Minute)
	s.rateLimiter = NewPeerRateLimiter(100, time.Minute, 10*time.Second)

	s.tmpDir = s.T().TempDir()
	s.p2pEvents = nil
	s.bridgeSent = nil
}

func (s *EndToEndSuite) TearDownTest() {
	s.store.Close()
}

func (s *EndToEndSuite) collectedP2PEvents() []P2PEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := make([]P2PEvent, len(s.p2pEvents))
	copy(cp, s.p2pEvents)
	return cp
}

func (s *EndToEndSuite) collectedBridgeEvents() []sentEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := make([]sentEvent, len(s.bridgeSent))
	copy(cp, s.bridgeSent)
	return cp
}

// bridgeSentEvent is reused from pairing_test.go (same package).
// The sentEvent type is already declared there, so we use it directly.

// TestUnifiedFlow runs all 15 phases sequentially, each building on prior state.
func (s *EndToEndSuite) TestUnifiedFlow() {
	ctx := s.ctx

	// =========================================================================
	// Phase 1: Node Registration & Config
	// =========================================================================
	pmNode, err := s.engine.RegisterNode(ctx, "pm-inv", VerticalPM, "project-alpha", "alice", false)
	s.Require().NoError(err)
	s.pmNode = pmNode

	devNode, err := s.engine.RegisterNode(ctx, "dev-inv", VerticalDev, "project-alpha", "bob", false)
	s.Require().NoError(err)
	s.devNode = devNode

	qaNode, err := s.engine.RegisterNode(ctx, "qa-inv", VerticalQA, "project-alpha", "claude", true)
	s.Require().NoError(err)
	s.qaNode = qaNode

	nodes, err := s.engine.ListNodes(ctx, "project-alpha")
	s.Require().NoError(err)
	s.Len(nodes, 3)

	// Register peers for governance quorum
	for _, p := range []struct {
		peerID, nodeID, name string
		vertical             Vertical
		owner                string
		isAI                 bool
	}{
		{s.pmPeerID, pmNode.ID, "alice", VerticalPM, "alice", false},
		{s.devPeerID, devNode.ID, "bob", VerticalDev, "bob", false},
		{s.qaPeerID, qaNode.ID, "claude", VerticalQA, "claude", true},
	} {
		err := s.store.CreatePeer(ctx, &Peer{
			PeerID: p.peerID, NodeID: p.nodeID, Name: p.name,
			Vertical: p.vertical, Project: "project-alpha", Owner: p.owner,
			IsAI: p.isAI, Status: PeerStatusApproved,
		})
		s.Require().NoError(err)
	}

	// Config round-trip
	cfg := DefaultNodeConfig()
	cfg.Node.Name = "pm-inv"
	cfg.Node.Vertical = VerticalPM
	cfg.Node.Project = "project-alpha"
	cfg.Node.Owner = "alice"
	cfgPath := filepath.Join(s.tmpDir, "node.yaml")
	s.Require().NoError(WriteNodeConfig(cfgPath, cfg))
	loaded, err := LoadNodeConfig(cfgPath)
	s.Require().NoError(err)
	s.Equal("pm-inv", loaded.Node.Name)
	s.Equal(VerticalPM, loaded.Node.Vertical)

	// =========================================================================
	// Phase 2: Item Creation with Kind Detection
	// =========================================================================
	s.Equal(KindAPISpec, DetectItemKind("auth_handler.go"))
	s.Equal(KindTestCase, DetectItemKind("auth_handler_test.go"))
	s.Equal(KindDecision, DetectItemKind("docs/plans/2026-03-19-auth-adr.md"))

	pmEpic, err := s.engine.AddItem(ctx, pmNode.ID, KindEpic, "Kiosk Check-in Epic", "Self-service kiosk", "")
	s.Require().NoError(err)
	pmStory, err := s.engine.AddItem(ctx, pmNode.ID, KindUserStory, "US-001 Login Flow", "User can login", "")
	s.Require().NoError(err)

	devAPI, err := s.engine.AddItem(ctx, devNode.ID, DetectItemKind("auth_handler.go"), "auth_handler.go", "WebSocket auth handler", "")
	s.Require().NoError(err)
	s.Equal(KindAPISpec, devAPI.Kind)
	devTest, err := s.engine.AddItem(ctx, devNode.ID, DetectItemKind("auth_handler_test.go"), "auth_handler_test.go", "Handler tests", "")
	s.Require().NoError(err)
	devADR, err := s.engine.AddItem(ctx, devNode.ID, DetectItemKind("docs/plans/2026-03-19-auth-adr.md"), "Auth ADR", "Architecture decision", "")
	s.Require().NoError(err)

	qaTestPlan, err := s.engine.AddItem(ctx, qaNode.ID, KindTestPlan, "E2E Test Plan", "Login + checkout flows", "")
	s.Require().NoError(err)
	qaTestCase, err := s.engine.AddItem(ctx, qaNode.ID, KindTestCase, "Login E2E Test", "Selenium login test", "")
	s.Require().NoError(err)

	pmItems, err := s.engine.ListItems(ctx, pmNode.ID)
	s.Require().NoError(err)
	s.Len(pmItems, 2)
	devItems, err := s.engine.ListItems(ctx, devNode.ID)
	s.Require().NoError(err)
	s.Len(devItems, 3)
	qaItems, err := s.engine.ListItems(ctx, qaNode.ID)
	s.Require().NoError(err)
	s.Len(qaItems, 2)

	// =========================================================================
	// Phase 3: Traceability — Cross-Node Traces
	// =========================================================================
	t1, err := s.engine.AddTrace(ctx, devAPI.ID, pmEpic.ID, RelationTracedFrom, "bob")
	s.Require().NoError(err)
	s.Equal(devNode.ID, t1.FromNodeID)
	s.Equal(pmNode.ID, t1.ToNodeID)

	_, err = s.engine.AddTrace(ctx, devADR.ID, pmStory.ID, RelationTracedFrom, "bob")
	s.Require().NoError(err)
	_, err = s.engine.AddTrace(ctx, qaTestPlan.ID, devADR.ID, RelationTracedFrom, "claude")
	s.Require().NoError(err)
	_, err = s.engine.AddTrace(ctx, qaTestCase.ID, devAPI.ID, RelationTracedFrom, "claude")
	s.Require().NoError(err)

	// Verify trace chains
	apiTraces, err := s.engine.GetItemTraces(ctx, devAPI.ID)
	s.Require().NoError(err)
	s.GreaterOrEqual(len(apiTraces), 1)

	upChain, err := s.engine.TraceUp(ctx, qaTestPlan.ID)
	s.Require().NoError(err)
	s.GreaterOrEqual(len(upChain), 2, "QA test plan should trace up to PM story via Dev ADR")

	downChain, err := s.engine.TraceDown(ctx, pmEpic.ID)
	s.Require().NoError(err)
	s.GreaterOrEqual(len(downChain), 2, "PM epic should trace down to QA items")

	// =========================================================================
	// Phase 4: Verification & State Transitions
	// =========================================================================
	allItems := []*Item{pmEpic, pmStory, devAPI, devTest, devADR, qaTestPlan, qaTestCase}
	actors := []string{"alice", "alice", "bob", "bob", "bob", "claude", "claude"}
	for i, item := range allItems {
		err := s.engine.VerifyItem(ctx, item.ID, fmt.Sprintf("Evidence for %s", item.Title), actors[i])
		s.Require().NoError(err, "verify %s", item.Title)
	}

	verifiedItem, err := s.engine.GetItem(ctx, devAPI.ID)
	s.Require().NoError(err)
	s.Equal(StatusProven, verifiedItem.Status)

	transitions, err := s.engine.GetItemTransitions(ctx, devAPI.ID)
	s.Require().NoError(err)
	s.GreaterOrEqual(len(transitions), 1)
	s.Equal(TransitionVerify, transitions[0].Kind)

	// =========================================================================
	// Phase 5: Signal Propagation — Cascade & Break
	// =========================================================================
	// PropagateChange on pmEpic marks its proven dependents as suspect (recursive).
	// pmEpic itself stays proven — the propagator only affects dependents.
	signals, err := s.engine.PropagateChange(ctx, pmEpic.ID)
	s.Require().NoError(err)
	s.GreaterOrEqual(len(signals), 1, "should propagate at least one signal")

	// devAPI (direct dependent of pmEpic) should now be suspect
	suspectAPI, err := s.engine.GetItem(ctx, devAPI.ID)
	s.Require().NoError(err)
	s.Equal(StatusSuspect, suspectAPI.Status, "devAPI should become suspect")

	// qaTestCase (dependent of devAPI) should also be suspect (transitive propagation)
	suspectQATest, err := s.engine.GetItem(ctx, qaTestCase.ID)
	s.Require().NoError(err)
	s.Equal(StatusSuspect, suspectQATest.Status, "QA test should become suspect (transitive)")

	// pmEpic stays proven (propagation doesn't change the source)
	epicAfterProp, err := s.engine.GetItem(ctx, pmEpic.ID)
	s.Require().NoError(err)
	s.Equal(StatusProven, epicAfterProp.Status, "pmEpic remains proven after propagation")

	// Items not in the trace chain remain proven
	unaffectedItem, err := s.engine.GetItem(ctx, devTest.ID)
	s.Require().NoError(err)
	s.Equal(StatusProven, unaffectedItem.Status, "devTest has no trace from pmEpic")

	// Now break a suspect item (suspect → broke is valid)
	err = s.engine.MarkBroken(ctx, devAPI.ID, "API endpoint removed after scope change", "bob")
	s.Require().NoError(err)
	brokenAPI, err := s.engine.GetItem(ctx, devAPI.ID)
	s.Require().NoError(err)
	s.Equal(StatusBroke, brokenAPI.Status)

	// =========================================================================
	// Phase 6: Checklist Workflow
	// =========================================================================
	entry1, err := s.engine.AddChecklistEntry(ctx, devADR.ID, "Architecture peer reviewed")
	s.Require().NoError(err)
	entry2, err := s.engine.AddChecklistEntry(ctx, devADR.ID, "Security implications documented")
	s.Require().NoError(err)
	_, err = s.engine.AddChecklistEntry(ctx, devADR.ID, "Performance benchmarks attached")
	s.Require().NoError(err)

	err = s.engine.CheckEntry(ctx, entry1.ID, "Review notes link", "bob")
	s.Require().NoError(err)
	err = s.engine.CheckEntry(ctx, entry2.ID, "OWASP checklist", "bob")
	s.Require().NoError(err)
	err = s.engine.UncheckEntry(ctx, entry2.ID)
	s.Require().NoError(err)

	checklist, err := s.engine.GetItemChecklist(ctx, devADR.ID)
	s.Require().NoError(err)
	s.Len(checklist, 3)

	summary, err := s.engine.GetItemSummary(ctx, devADR.ID)
	s.Require().NoError(err)
	s.Equal(3, summary.Checklist.Total)
	s.Equal(1, summary.Checklist.Checked)

	nodeSummaries, err := s.engine.GetNodeItemSummaries(ctx, devNode.ID)
	s.Require().NoError(err)
	s.Len(nodeSummaries, 3)

	// =========================================================================
	// Phase 7: Challenge Lifecycle
	// =========================================================================
	ch, err := s.challengeEng.CreateChallenge(ctx, ChallengeWeakEvidence,
		s.qaPeerID, s.devPeerID, devAPI.ID, "",
		"API spec has no coverage proof", "", 24*time.Hour)
	s.Require().NoError(err)
	s.Equal(ChallengeOpen, ch.Status)

	err = s.challengeEng.RespondToChallenge(ctx, ch.ID, "Added 92% coverage proof")
	s.Require().NoError(err)
	responded, err := s.store.GetChallenge(ctx, ch.ID)
	s.Require().NoError(err)
	s.Equal(ChallengeResponded, responded.Status)

	resolved, err := s.challengeEng.ResolveChallenge(ctx, ch.ID, "project-alpha")
	s.Require().NoError(err)
	s.Equal(ChallengeSustained, resolved.Status)

	qaRep, err := s.store.GetPeerReputation(ctx, s.qaPeerID)
	s.Require().NoError(err)
	s.Equal(1, qaRep, "challenger gets +1")
	devRep, err := s.store.GetPeerReputation(ctx, s.devPeerID)
	s.Require().NoError(err)
	s.Equal(-1, devRep, "challenged gets -1")

	// =========================================================================
	// Phase 8: Change Request Governance
	// =========================================================================
	cr, err := s.engine.CreateCR(ctx, "Switch to WebSocket", "Replace HTTP polling", "bob", devNode.ID, []string{devAPI.ID})
	s.Require().NoError(err)
	s.Equal(CRDraft, cr.Status)

	err = s.engine.SubmitCR(ctx, cr.ID)
	s.Require().NoError(err)
	err = s.engine.OpenVoting(ctx, cr.ID)
	s.Require().NoError(err)

	// PM casts human approve
	err = s.engine.CastVote(ctx, cr.ID, pmNode.ID, "alice", VoteApprove, "good idea", false)
	s.Require().NoError(err)
	// QA casts AI approve (advisory only)
	err = s.engine.CastVote(ctx, cr.ID, qaNode.ID, "claude", VoteApprove, "tests look ok", true)
	s.Require().NoError(err)

	tally, err := s.engine.TallyVotes(ctx, cr.ID)
	s.Require().NoError(err)
	s.Equal(VoteApprove, tally, "1 human approve should pass")

	err = s.engine.ResolveCR(ctx, cr.ID)
	s.Require().NoError(err)
	resolvedCR, err := s.store.GetChangeRequest(ctx, cr.ID)
	s.Require().NoError(err)
	s.Equal(CRApproved, resolvedCR.Status)

	// =========================================================================
	// Phase 9: P2P Event Handling
	// =========================================================================
	// Re-verify devAPI so it can be used by signal handler
	err = s.engine.VerifyItem(ctx, devAPI.ID, "re-verified after scope change", "bob")
	s.Require().NoError(err)

	p2pEventsBefore := len(s.collectedP2PEvents())

	// P2P challenge via handler (bypasses cooldown)
	remoteCh := &Challenge{
		Kind: ChallengeStaleData, ChallengerPeer: "remote-peer",
		ChallengedPeer: s.devPeerID, TargetItemID: devAPI.ID,
		Reason: "Outdated API", Deadline: time.Now().Add(24 * time.Hour),
	}
	err = s.p2pHandlers.HandleChallengeCreate(ctx, remoteCh)
	s.Require().NoError(err)

	// P2P query
	err = s.p2pHandlers.HandleQueryAsk(ctx, "q-remote-1", "external-asker", "What API version?", "integration planning")
	s.Require().NoError(err)

	p2pEventsAfter := s.collectedP2PEvents()
	newEvents := p2pEventsAfter[p2pEventsBefore:]
	s.GreaterOrEqual(len(newEvents), 2, "should have challenge + query events")

	foundChallenge := false
	foundQuery := false
	for _, e := range newEvents {
		if e.Type == P2PChallengeReceived {
			foundChallenge = true
		}
		if e.Type == P2PQueryReceived {
			foundQuery = true
		}
	}
	s.True(foundChallenge, "P2PChallengeReceived event expected")
	s.True(foundQuery, "P2PQueryReceived event expected")

	// =========================================================================
	// Phase 10: Pairing Session
	// =========================================================================
	bridgeBefore := len(s.collectedBridgeEvents())

	ps, err := s.engine.InvitePair(ctx, s.pmPeerID, pmNode.ID, s.devPeerID, devNode.ID)
	s.Require().NoError(err)
	s.Equal(PairingPending, ps.Status)

	accepted, err := s.engine.AcceptPair(ctx, ps.ID, s.devPeerID)
	s.Require().NoError(err)
	s.Equal(PairingActive, accepted.Status)

	activeSessions, err := s.engine.ListPairingSessions(ctx, s.pmPeerID)
	s.Require().NoError(err)
	s.Len(activeSessions, 1)

	// Dispatch a non-pairing event — should be forwarded by bridge
	s.p2pBus.Dispatch(ctx, P2PEvent{
		Type:    P2PSignalReceived,
		Payload: SignalEventPayload{SourceItemID: "sig-item", SourceNodeID: "sig-node", TargetItemID: "sig-target", Reason: "e2e test"},
	})

	// Dispatch a pairing event — should NOT be forwarded (loop prevention)
	s.p2pBus.Dispatch(ctx, P2PEvent{
		Type:    P2PPairInviteReceived,
		Payload: PairingEventPayload{Session: ps},
	})

	bridgeAfter := s.collectedBridgeEvents()
	newBridgeEvents := bridgeAfter[bridgeBefore:]
	s.Len(newBridgeEvents, 1, "only the signal event should be forwarded, not the pairing event")
	s.Equal(s.devPeerID, newBridgeEvents[0].ToPeerID)
	s.Equal(string(P2PSignalReceived), newBridgeEvents[0].EventKind)

	// End pairing
	ended, err := s.engine.EndPair(ctx, ps.ID, s.pmPeerID)
	s.Require().NoError(err)
	s.Equal(PairingEnded, ended.Status)
	s.NotNil(ended.EndedAt)

	activeAfterEnd, err := s.engine.ListPairingSessions(ctx, s.pmPeerID)
	s.Require().NoError(err)
	s.Empty(activeAfterEnd)

	// =========================================================================
	// Phase 11: Event Dispatcher — Persist, Acknowledge, Prune
	// =========================================================================
	s.Require().NoError(s.dispatcher.Dispatch(ctx, NodeEvent{
		Kind: EventChallengeReceived, Timestamp: time.Now(), Urgent: true,
		Payload: EventPayload{Challenge: &ChallengeEventData{
			ChallengeID: "ch-e2e", Kind: "weak_evidence", FromPeer: s.qaPeerID,
			TargetItem: devAPI.ID, Reason: "E2E test", Deadline: time.Now().Add(24 * time.Hour),
		}},
	}))
	s.Require().NoError(s.dispatcher.Dispatch(ctx, NodeEvent{
		Kind: EventPeerJoined, Timestamp: time.Now(), Urgent: false,
		Payload: EventPayload{Peer: &PeerEventData{PeerID: "peer-new", Name: "new-node"}},
	}))
	s.Require().NoError(s.dispatcher.Dispatch(ctx, NodeEvent{
		Kind: EventSignalReceived, Timestamp: time.Now(), Urgent: true,
		Payload: EventPayload{Signal: &SignalEventData{ItemID: devAPI.ID, SourceItem: pmEpic.ID, Reason: "cascade"}},
	}))

	pending, err := s.engine.GetPendingEvents(ctx)
	s.Require().NoError(err)
	s.Len(pending, 3)
	// First urgent event
	s.True(pending[0].Urgent)

	// Acknowledge first
	err = s.engine.AcknowledgeEvents(ctx, []string{pending[0].ID})
	s.Require().NoError(err)
	remaining, err := s.engine.GetPendingEvents(ctx)
	s.Require().NoError(err)
	s.Len(remaining, 2)

	// Backdate one event and prune
	_, err = s.store.db.ExecContext(ctx,
		`UPDATE events SET created_at = datetime('now', '-10 days'), read = 1 WHERE id = ?`, pending[1].ID)
	s.Require().NoError(err)
	pruned, err := s.store.PruneOldEvents(ctx, 7)
	s.Require().NoError(err)
	s.Equal(1, pruned)

	s.True(IsUrgentEvent(EventChallengeReceived))
	s.False(IsUrgentEvent(EventPeerJoined))

	// =========================================================================
	// Phase 12: Network Query
	// =========================================================================
	query, err := s.engine.AskNetwork(ctx, "claude", qaNode.ID, "Which endpoint implements US-001?", "sprint review", devNode.ID)
	s.Require().NoError(err)
	s.Equal(devNode.ID, query.TargetNode)
	s.False(query.Resolved)

	resp, err := s.engine.RespondToQuery(ctx, query.ID, "bob", devNode.ID, "auth_handler.go implements US-001", false)
	s.Require().NoError(err)
	s.Equal(query.ID, resp.QueryID)
	s.False(resp.IsAI)

	// =========================================================================
	// Phase 13: Security Layers
	// =========================================================================
	s.False(s.msgCache.IsSeen("msg-e2e-1"))
	s.msgCache.MarkSeen("msg-e2e-1")
	s.True(s.msgCache.IsSeen("msg-e2e-1"))

	s.True(s.msgCache.IsWithinWindow(time.Now()))
	s.False(s.msgCache.IsWithinWindow(time.Now().Add(-10 * time.Minute)))

	s.True(s.rateLimiter.AllowMessage(s.devPeerID))
	s.True(s.rateLimiter.AllowQuery(s.devPeerID))
	s.False(s.rateLimiter.IsThrottled(s.devPeerID))

	// =========================================================================
	// Phase 14: Audit All Nodes
	// =========================================================================
	reports, err := s.engine.AuditAllNodes(ctx, "project-alpha")
	s.Require().NoError(err)
	s.Len(reports, 3)

	totalItems := 0
	for _, r := range reports {
		totalItems += r.TotalItems
	}
	s.Equal(7, totalItems)

	// After Phase 5 propagation + Phase 9 re-verify:
	// - pmEpic: proven (never broken, propagation doesn't change source)
	// - devAPI: proven (fixed in Phase 9)
	// - qaTestCase: suspect (from Phase 5 propagation, never re-verified)
	// QA node should have suspect items
	qaReport := reports[2] // qa node is third registered
	s.GreaterOrEqual(len(qaReport.Suspect), 1, "QA test case should still be suspect")

	// =========================================================================
	// Phase 15: Session Status & JSON Serialization
	// =========================================================================
	status, err := s.engine.GetSessionStatus(ctx, "project-alpha", devNode.ID)
	s.Require().NoError(err)
	s.Equal(devNode.ID, status.MyNode.ID)
	s.Len(status.Nodes, 3)
	s.NotNil(status.AuditReport)

	data, err := json.Marshal(status)
	s.Require().NoError(err)
	var parsed map[string]json.RawMessage
	s.Require().NoError(json.Unmarshal(data, &parsed))

	expectedFields := []string{"nodes", "my_node", "suspect_items", "broken_items",
		"pending_crs", "active_challenges", "unanswered_queries", "audit_report", "pending_events"}
	for _, field := range expectedFields {
		_, exists := parsed[field]
		s.True(exists, "missing field: %s", field)
	}

	// Permission mode response
	normalResp := BuildConfigModeResponse(PermissionNormal)
	s.Equal(PermissionNormal, normalResp.CurrentMode)
	s.Contains(normalResp.RequiresHumanFor, string(ActionFileChallenge))

	autoResp := BuildConfigModeResponse(PermissionAutonomous)
	s.Contains(autoResp.AutonomousActions, string(ActionAddItem))
	s.Contains(autoResp.AlwaysAutonomous, string(ActionPropagateSignal))
}
