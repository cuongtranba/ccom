package main

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/suite"
)

type WorkflowSuite struct {
	suite.Suite
	store      *Store
	engine     *Engine
	dispatcher *EventDispatcher
}

func TestWorkflowSuite(t *testing.T) {
	suite.Run(t, new(WorkflowSuite))
}

func (s *WorkflowSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store

	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	s.engine = NewEngine(store, prop, crsm)

	logger := zerolog.Nop()
	s.dispatcher = NewEventDispatcher(store, logger)
}

func (s *WorkflowSuite) TearDownTest() {
	s.store.Close()
}

// Scenario: Full session lifecycle
func (s *WorkflowSuite) TestSessionLifecycle() {
	ctx := context.Background()

	// 1. Register node
	node, err := s.engine.RegisterNode(ctx, "dev-inv", VerticalDev, "clinic-checkin", "cuong", false)
	s.Require().NoError(err)

	// 2. Session start — check status
	status, err := s.engine.GetSessionStatus(ctx, "clinic-checkin", node.ID)
	s.NoError(err)
	s.Equal(node.ID, status.MyNode.ID)
	s.Equal(0, status.PendingEvents)
	s.Empty(status.SuspectItems)

	// 3. Check pending events (should be empty)
	events, err := s.engine.GetPendingEvents(ctx)
	s.NoError(err)
	s.Empty(events)

	// 4. Add an item during development
	item, err := s.engine.AddItem(ctx, node.ID, KindADR, "Auth design", "WebSocket auth handler", "")
	s.Require().NoError(err)

	// 5. Verify the item
	err = s.engine.VerifyItem(ctx, item.ID, "Tests pass at 87% coverage", "cuong")
	s.NoError(err)

	// 6. End of session — audit
	report, err := s.engine.Audit(ctx, node.ID)
	s.NoError(err)
	s.Equal(1, report.TotalItems)
	s.Len(report.Proven, 1)
}

// Scenario: Event notification flow
func (s *WorkflowSuite) TestEventNotificationFlow() {
	ctx := context.Background()

	node, err := s.engine.RegisterNode(ctx, "dev-inv", VerticalDev, "clinic-checkin", "cuong", false)
	s.Require().NoError(err)
	_ = node

	// 1. Simulate incoming events from P2P
	events := []NodeEvent{
		{
			Kind: EventChallengeReceived, Timestamp: time.Now(), Urgent: true,
			Payload: EventPayload{Challenge: &ChallengeEventData{
				ChallengeID: "ch-001", Kind: "weak_evidence", FromPeer: "peer-qa",
				TargetItem: "item-auth", Reason: "Low coverage", Deadline: time.Now().Add(24 * time.Hour),
			}},
		},
		{
			Kind: EventPeerJoined, Timestamp: time.Now(), Urgent: false,
			Payload: EventPayload{Peer: &PeerEventData{PeerID: "peer-pm", Name: "pm-node"}},
		},
		{
			Kind: EventQueryReceived, Timestamp: time.Now(), Urgent: false,
			Payload: EventPayload{Query: &QueryEventData{
				QueryID: "q-001", Question: "What implements US-003?", Asker: "pm-node",
			}},
		},
	}

	for _, e := range events {
		err := s.dispatcher.Dispatch(ctx, e)
		s.NoError(err)
	}

	// 2. Check session status — should reflect pending events
	status, err := s.engine.GetSessionStatus(ctx, "clinic-checkin", node.ID)
	s.NoError(err)
	s.Equal(3, status.PendingEvents)

	// 3. Fetch pending events
	pending, err := s.engine.GetPendingEvents(ctx)
	s.NoError(err)
	s.Len(pending, 3)
	// First event should be urgent
	s.True(pending[0].Urgent)
	s.Equal(EventChallengeReceived, pending[0].Kind)

	// 4. Acknowledge events
	ids := make([]string, len(pending))
	for i, e := range pending {
		ids[i] = e.ID
	}
	err = s.engine.AcknowledgeEvents(ctx, ids)
	s.NoError(err)

	// 5. Verify no more pending
	remaining, err := s.engine.GetPendingEvents(ctx)
	s.NoError(err)
	s.Empty(remaining)
}

// Scenario: Permission mode affects behavior
func (s *WorkflowSuite) TestPermissionModeMatrix() {
	// Normal mode: everything requires human
	s.True(RequiresHumanConfirmation(PermissionNormal, ActionAddItem))
	s.True(RequiresHumanConfirmation(PermissionNormal, ActionVerifyItem))
	s.True(RequiresHumanConfirmation(PermissionNormal, ActionFileChallenge))

	// Autonomous mode: only governance requires human
	s.False(RequiresHumanConfirmation(PermissionAutonomous, ActionAddItem))
	s.False(RequiresHumanConfirmation(PermissionAutonomous, ActionVerifyItem))
	s.True(RequiresHumanConfirmation(PermissionAutonomous, ActionFileChallenge))

	// Always autonomous in both modes
	s.False(RequiresHumanConfirmation(PermissionNormal, ActionPropagateSignal))
	s.False(RequiresHumanConfirmation(PermissionAutonomous, ActionPropagateSignal))
}

// Scenario: Multi-node oversight
func (s *WorkflowSuite) TestMultiNodeOversight() {
	ctx := context.Background()

	// Register multiple nodes
	devNode, err := s.engine.RegisterNode(ctx, "dev-inv", VerticalDev, "clinic-checkin", "cuong", false)
	s.Require().NoError(err)
	pmNode, err := s.engine.RegisterNode(ctx, "pm-inv", VerticalPM, "clinic-checkin", "duke", false)
	s.Require().NoError(err)
	qaNode, err := s.engine.RegisterNode(ctx, "qa-inv", VerticalQA, "clinic-checkin", "blue", true)
	s.Require().NoError(err)

	// Add items to each node
	_, err = s.engine.AddItem(ctx, devNode.ID, KindADR, "Auth design", "", "")
	s.Require().NoError(err)
	_, err = s.engine.AddItem(ctx, devNode.ID, KindAPISpec, "Auth API", "", "")
	s.Require().NoError(err)
	_, err = s.engine.AddItem(ctx, pmNode.ID, KindEpic, "Kiosk check-in", "", "")
	s.Require().NoError(err)
	_, err = s.engine.AddItem(ctx, qaNode.ID, KindTestCase, "E2E login test", "", "")
	s.Require().NoError(err)
	_, err = s.engine.AddItem(ctx, qaNode.ID, KindTestCase, "E2E checkout test", "", "")
	s.Require().NoError(err)

	// Audit all nodes at once
	reports, err := s.engine.AuditAllNodes(ctx, "clinic-checkin")
	s.NoError(err)
	s.Len(reports, 3)

	// Calculate totals
	totalItems := 0
	for _, r := range reports {
		totalItems += r.TotalItems
	}
	s.Equal(5, totalItems)
}

// Scenario: Event persistence survives simulated restart
func (s *WorkflowSuite) TestEventPersistence() {
	ctx := context.Background()

	// Dispatch events
	for i := 0; i < 5; i++ {
		s.Require().NoError(s.dispatcher.Dispatch(ctx, NodeEvent{
			Kind:      EventPeerJoined,
			Timestamp: time.Now(),
			Urgent:    false,
			Payload: EventPayload{
				Peer: &PeerEventData{PeerID: fmt.Sprintf("peer-%d", i), Name: fmt.Sprintf("node-%d", i)},
			},
		}))
	}

	// Verify persistence
	pending, err := s.store.GetPendingEvents(ctx)
	s.NoError(err)
	s.Len(pending, 5)

	// Acknowledge some
	s.Require().NoError(s.engine.AcknowledgeEvents(ctx, []string{pending[0].ID, pending[1].ID}))

	// "Restart" — create new engine/dispatcher pointing at same store
	logger := zerolog.Nop()
	newDispatcher := NewEventDispatcher(s.store, logger)
	_ = newDispatcher

	// Should still have 3 pending
	remaining, err := s.store.GetPendingEvents(ctx)
	s.NoError(err)
	s.Len(remaining, 3)
}

// Scenario: Event pruning cleans old events
func (s *WorkflowSuite) TestEventPruning() {
	ctx := context.Background()

	// Add old read events
	for i := 0; i < 3; i++ {
		s.Require().NoError(s.store.SaveEvent(ctx, &StoredEvent{
			ID:      fmt.Sprintf("old-%d", i),
			Kind:    EventPeerJoined,
			Payload: `{"peer":{"peer_id":"old"}}`,
			Urgent:  false,
			Read:    true,
		}))
		// Backdate to 10 days ago
		_, err := s.store.db.ExecContext(ctx,
			`UPDATE events SET created_at = datetime('now', '-10 days') WHERE id = ?`,
			fmt.Sprintf("old-%d", i))
		s.Require().NoError(err)
	}

	// Add recent events
	for i := 0; i < 2; i++ {
		s.Require().NoError(s.store.SaveEvent(ctx, &StoredEvent{
			ID:      fmt.Sprintf("new-%d", i),
			Kind:    EventPeerJoined,
			Payload: `{"peer":{"peer_id":"new"}}`,
			Urgent:  false,
			Read:    false,
		}))
	}

	pruned, err := s.store.PruneOldEvents(ctx, 7)
	s.NoError(err)
	s.Equal(3, pruned)

	pending, err := s.store.GetPendingEvents(ctx)
	s.NoError(err)
	s.Len(pending, 2)
}

// Scenario: Kind detection during development
func (s *WorkflowSuite) TestKindDetectionWorkflow() {
	ctx := context.Background()

	node, err := s.engine.RegisterNode(ctx, "dev-inv", VerticalDev, "clinic-checkin", "cuong", false)
	s.Require().NoError(err)

	// Simulate file changes and detect kinds
	fileChanges := map[string]ItemKind{
		"auth_handler.go":                      KindAPISpec,
		"auth_handler_test.go":                 KindTestCase,
		"proto/auth.proto":                     KindAPISpec,
		"docs/plans/2026-03-18-auth-design.md": KindDecision,
		"user_model.go":                        KindDataModel,
	}

	for file, expectedKind := range fileChanges {
		detectedKind := DetectItemKind(file)
		s.Equal(expectedKind, detectedKind, "file: %s", file)

		// Create item with detected kind
		_, err := s.engine.AddItem(ctx, node.ID, detectedKind, file, "", "")
		s.NoError(err)
	}

	items, err := s.engine.ListItems(ctx, node.ID)
	s.NoError(err)
	s.Len(items, 5)
}

// Scenario: SessionStatus serializes properly for MCP
func (s *WorkflowSuite) TestSessionStatusSerialization() {
	ctx := context.Background()

	node, err := s.engine.RegisterNode(ctx, "dev-inv", VerticalDev, "clinic-checkin", "cuong", false)
	s.Require().NoError(err)

	_, err = s.engine.AddItem(ctx, node.ID, KindADR, "Auth design", "", "")
	s.Require().NoError(err)

	status, err := s.engine.GetSessionStatus(ctx, "clinic-checkin", node.ID)
	s.NoError(err)

	// Serialize to JSON (as MCP would)
	data, err := json.Marshal(status)
	s.NoError(err)

	// Parse back and verify structure
	var parsed map[string]json.RawMessage
	err = json.Unmarshal(data, &parsed)
	s.NoError(err)

	// Verify all expected fields are present
	expectedFields := []string{"nodes", "my_node", "suspect_items", "broken_items",
		"pending_crs", "active_challenges", "unanswered_queries", "audit_report", "pending_events"}
	for _, field := range expectedFields {
		_, exists := parsed[field]
		s.True(exists, "missing field: %s", field)
	}
}
