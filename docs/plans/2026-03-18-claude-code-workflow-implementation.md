# Claude Code Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the Claude Code workflow integration: real-time event notifications, session status, permission modes, multi-node audit, CLAUDE.md template, and Claude Code hooks. This enables human+AI orchestration through `inv` MCP tools.

**Architecture:** Flat package at root. Engine orchestrates Store (SQLite) + StateMachine + SignalPropagator + EventDispatcher. CLI (Cobra) and MCP server both call Engine. DI via pumped-go. Two zerolog instances: agent (stdout) for data, system (stderr) for diagnostics.

**Tech Stack:** Go 1.25, SQLite (go-sqlite3), Cobra, mcp-go (v0.45.0), pumped-go (v0.1.3), zerolog, testify

**Depends on:** P2P Network implementation (assumes `p2p.go`, `p2p_handlers.go`, `p2p_sender.go`, `security.go`, `challenge.go`, `proposal.go`, `identity.go`, `config.go`, `proto/inv.proto`, `proto/inv.pb.go` all exist)

---

## Task 1: Event Types — `EventKind`, `NodeEvent`, Typed Payloads

**Files:**
- Create: `events.go`

**Step 1: Write failing test**

Create `events_test.go`:

```go
package main

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/suite"
)

type EventTypesSuite struct {
	suite.Suite
}

func TestEventTypesSuite(t *testing.T) {
	suite.Run(t, new(EventTypesSuite))
}

func (s *EventTypesSuite) TestEventKindConstants() {
	s.Equal(EventKind("governance.challenge_received"), EventChallengeReceived)
	s.Equal(EventKind("governance.vote_requested"), EventVoteRequested)
	s.Equal(EventKind("governance.proposal_result"), EventProposalResult)
	s.Equal(EventKind("governance.challenge_result"), EventChallengeResult)
	s.Equal(EventKind("governance.membership_request"), EventMembershipRequest)
	s.Equal(EventKind("network.peer_joined"), EventPeerJoined)
	s.Equal(EventKind("network.peer_lost"), EventPeerLost)
	s.Equal(EventKind("network.signal_received"), EventSignalReceived)
	s.Equal(EventKind("network.query_received"), EventQueryReceived)
	s.Equal(EventKind("network.sweep_received"), EventSweepReceived)
}

func (s *EventTypesSuite) TestNodeEventJSON() {
	event := NodeEvent{
		Kind:      EventChallengeReceived,
		Timestamp: time.Date(2026, 3, 18, 12, 0, 0, 0, time.UTC),
		Urgent:    true,
		Payload: EventPayload{
			Challenge: &ChallengeEventData{
				ChallengeID: "ch-001",
				Kind:        "weak_evidence",
				FromPeer:    "peer-qa",
				TargetItem:  "item-auth",
				Reason:      "Test coverage is only 30%",
				Deadline:    time.Date(2026, 3, 19, 12, 0, 0, 0, time.UTC),
			},
		},
	}

	data, err := json.Marshal(event)
	s.NoError(err)

	var decoded NodeEvent
	err = json.Unmarshal(data, &decoded)
	s.NoError(err)
	s.Equal(EventChallengeReceived, decoded.Kind)
	s.True(decoded.Urgent)
	s.NotNil(decoded.Payload.Challenge)
	s.Equal("ch-001", decoded.Payload.Challenge.ChallengeID)
	s.Nil(decoded.Payload.Proposal)
}

func (s *EventTypesSuite) TestEventPayloadOnlyOneField() {
	// Verify that only the relevant payload field is non-nil
	event := NodeEvent{
		Kind:      EventPeerJoined,
		Timestamp: time.Now(),
		Urgent:    false,
		Payload: EventPayload{
			Peer: &PeerEventData{
				PeerID: "peer-123",
				Name:   "dev-node",
			},
		},
	}

	s.NotNil(event.Payload.Peer)
	s.Nil(event.Payload.Challenge)
	s.Nil(event.Payload.Proposal)
	s.Nil(event.Payload.Membership)
	s.Nil(event.Payload.Signal)
	s.Nil(event.Payload.Query)
	s.Nil(event.Payload.Sweep)
}

func (s *EventTypesSuite) TestIsUrgent() {
	s.True(IsUrgentEvent(EventChallengeReceived))
	s.True(IsUrgentEvent(EventVoteRequested))
	s.True(IsUrgentEvent(EventMembershipRequest))
	s.True(IsUrgentEvent(EventSignalReceived))
	s.False(IsUrgentEvent(EventProposalResult))
	s.False(IsUrgentEvent(EventChallengeResult))
	s.False(IsUrgentEvent(EventPeerJoined))
	s.False(IsUrgentEvent(EventPeerLost))
	s.False(IsUrgentEvent(EventQueryReceived))
	s.False(IsUrgentEvent(EventSweepReceived))
}
```

**Step 2: Run test — expect compilation failure**

Run: `go test -run TestEventTypesSuite -v ./...`
Expected: Compilation error — `EventKind`, `NodeEvent`, etc. undefined.

**Step 3: Implement event types**

Create `events.go`:

```go
package main

import "time"

// EventKind identifies the type of event that occurred in the inventory network.
type EventKind string

const (
	EventChallengeReceived EventKind = "governance.challenge_received"
	EventVoteRequested     EventKind = "governance.vote_requested"
	EventProposalResult    EventKind = "governance.proposal_result"
	EventChallengeResult   EventKind = "governance.challenge_result"
	EventMembershipRequest EventKind = "governance.membership_request"
	EventPeerJoined        EventKind = "network.peer_joined"
	EventPeerLost          EventKind = "network.peer_lost"
	EventSignalReceived    EventKind = "network.signal_received"
	EventQueryReceived     EventKind = "network.query_received"
	EventSweepReceived     EventKind = "network.sweep_received"
)

// urgentEvents lists event kinds that require immediate human attention.
var urgentEvents = map[EventKind]bool{
	EventChallengeReceived: true,
	EventVoteRequested:     true,
	EventMembershipRequest: true,
	EventSignalReceived:    true,
}

// IsUrgentEvent returns true if the event kind requires immediate attention.
func IsUrgentEvent(kind EventKind) bool {
	return urgentEvents[kind]
}

// NodeEvent represents a single event in the inventory network.
type NodeEvent struct {
	Kind      EventKind    `json:"kind"`
	Timestamp time.Time    `json:"timestamp"`
	Urgent    bool         `json:"urgent"`
	Payload   EventPayload `json:"payload"`
}

// EventPayload contains the typed data for an event.
// Only one field is populated per event, corresponding to the EventKind.
type EventPayload struct {
	Challenge  *ChallengeEventData  `json:"challenge,omitempty"`
	Proposal   *ProposalEventData   `json:"proposal,omitempty"`
	Membership *MembershipEventData `json:"membership,omitempty"`
	Peer       *PeerEventData       `json:"peer,omitempty"`
	Signal     *SignalEventData     `json:"signal,omitempty"`
	Query      *QueryEventData      `json:"query,omitempty"`
	Sweep      *SweepEventData      `json:"sweep,omitempty"`
}

// ChallengeEventData carries challenge-related event information.
// Used by EventChallengeReceived and EventChallengeResult.
type ChallengeEventData struct {
	ChallengeID string    `json:"challenge_id"`
	Kind        string    `json:"kind"`
	FromPeer    string    `json:"from_peer"`
	TargetItem  string    `json:"target_item"`
	Reason      string    `json:"reason"`
	Deadline    time.Time `json:"deadline"`
	Outcome     string    `json:"outcome,omitempty"`
	Penalty     string    `json:"penalty,omitempty"`
}

// ProposalEventData carries proposal/CR-related event information.
// Used by EventVoteRequested and EventProposalResult.
type ProposalEventData struct {
	ProposalID   string `json:"proposal_id"`
	Kind         string `json:"kind"`
	Title        string `json:"title"`
	Deadline     string `json:"deadline,omitempty"`
	Decision     string `json:"decision,omitempty"`
	VotesFor     int    `json:"votes_for,omitempty"`
	VotesAgainst int    `json:"votes_against,omitempty"`
}

// MembershipEventData carries membership request information.
// Used by EventMembershipRequest.
type MembershipEventData struct {
	PeerID   string `json:"peer_id"`
	Name     string `json:"name"`
	Vertical string `json:"vertical"`
}

// PeerEventData carries peer status change information.
// Used by EventPeerJoined and EventPeerLost.
type PeerEventData struct {
	PeerID   string `json:"peer_id"`
	Name     string `json:"name"`
	LastSeen string `json:"last_seen,omitempty"`
}

// SignalEventData carries signal propagation information.
// Used by EventSignalReceived.
type SignalEventData struct {
	ItemID     string `json:"item_id"`
	SourceItem string `json:"source_item"`
	Reason     string `json:"reason"`
}

// QueryEventData carries incoming query information.
// Used by EventQueryReceived.
type QueryEventData struct {
	QueryID  string `json:"query_id"`
	Question string `json:"question"`
	Asker    string `json:"asker"`
}

// SweepEventData carries sweep broadcast information.
// Used by EventSweepReceived.
type SweepEventData struct {
	ExternalRef  string   `json:"external_ref"`
	MatchedItems []string `json:"matched_items"`
}
```

**Step 4: Run test — expect pass**

Run: `go test -run TestEventTypesSuite -v ./...`
Expected: All 4 tests pass.

**Step 5: Commit**

```bash
git add events.go events_test.go
git commit -m "feat: add event types for Claude Code workflow notifications"
```

---

## Task 2: Events SQLite Table — Persistence Layer

**Files:**
- Modify: `store.go:34-158` (add `events` table to schema)
- Modify: `store.go` (append SaveEvent, GetPendingEvents, MarkEventRead, MarkEventsRead, PruneOldEvents)

**Step 1: Write failing test**

Append to `events_test.go`:

```go
type EventStoreSuite struct {
	suite.Suite
	store *Store
}

func TestEventStoreSuite(t *testing.T) {
	suite.Run(t, new(EventStoreSuite))
}

func (s *EventStoreSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store
}

func (s *EventStoreSuite) TearDownTest() {
	s.store.Close()
}

func (s *EventStoreSuite) TestSaveAndGetPendingEvents() {
	ctx := context.Background()

	event1 := &StoredEvent{
		ID:      "evt-001",
		Kind:    EventChallengeReceived,
		Payload: `{"challenge":{"challenge_id":"ch-001"}}`,
		Urgent:  true,
		Read:    false,
	}
	event2 := &StoredEvent{
		ID:      "evt-002",
		Kind:    EventPeerJoined,
		Payload: `{"peer":{"peer_id":"peer-123"}}`,
		Urgent:  false,
		Read:    false,
	}

	err := s.store.SaveEvent(ctx, event1)
	s.NoError(err)
	err = s.store.SaveEvent(ctx, event2)
	s.NoError(err)

	pending, err := s.store.GetPendingEvents(ctx)
	s.NoError(err)
	s.Len(pending, 2)
	// Ordered by created_at ascending
	s.Equal("evt-001", pending[0].ID)
	s.Equal("evt-002", pending[1].ID)
}

func (s *EventStoreSuite) TestMarkEventRead() {
	ctx := context.Background()

	event := &StoredEvent{
		ID:      "evt-001",
		Kind:    EventChallengeReceived,
		Payload: `{"challenge":{"challenge_id":"ch-001"}}`,
		Urgent:  true,
		Read:    false,
	}
	err := s.store.SaveEvent(ctx, event)
	s.NoError(err)

	err = s.store.MarkEventRead(ctx, "evt-001")
	s.NoError(err)

	pending, err := s.store.GetPendingEvents(ctx)
	s.NoError(err)
	s.Empty(pending)
}

func (s *EventStoreSuite) TestMarkEventsRead() {
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		event := &StoredEvent{
			ID:      fmt.Sprintf("evt-%03d", i),
			Kind:    EventPeerJoined,
			Payload: `{"peer":{"peer_id":"peer"}}`,
			Urgent:  false,
			Read:    false,
		}
		s.Require().NoError(s.store.SaveEvent(ctx, event))
	}

	err := s.store.MarkEventsRead(ctx, []string{"evt-000", "evt-001"})
	s.NoError(err)

	pending, err := s.store.GetPendingEvents(ctx)
	s.NoError(err)
	s.Len(pending, 1)
	s.Equal("evt-002", pending[0].ID)
}

func (s *EventStoreSuite) TestPruneOldEvents() {
	ctx := context.Background()

	// Save an event, then manually backdating it in the DB
	event := &StoredEvent{
		ID:      "evt-old",
		Kind:    EventPeerJoined,
		Payload: `{"peer":{"peer_id":"peer"}}`,
		Urgent:  false,
		Read:    true,
	}
	s.Require().NoError(s.store.SaveEvent(ctx, event))

	// Backdate to 8 days ago
	_, err := s.store.db.ExecContext(ctx,
		`UPDATE events SET created_at = datetime('now', '-8 days') WHERE id = ?`, "evt-old")
	s.NoError(err)

	// Save a recent event
	recent := &StoredEvent{
		ID:      "evt-recent",
		Kind:    EventPeerJoined,
		Payload: `{"peer":{"peer_id":"peer"}}`,
		Urgent:  false,
		Read:    false,
	}
	s.Require().NoError(s.store.SaveEvent(ctx, recent))

	pruned, err := s.store.PruneOldEvents(ctx, 7)
	s.NoError(err)
	s.Equal(1, pruned)

	pending, err := s.store.GetPendingEvents(ctx)
	s.NoError(err)
	s.Len(pending, 1)
	s.Equal("evt-recent", pending[0].ID)
}

func (s *EventStoreSuite) TestGetPendingEventsCount() {
	ctx := context.Background()

	for i := 0; i < 5; i++ {
		event := &StoredEvent{
			ID:      fmt.Sprintf("evt-%03d", i),
			Kind:    EventPeerJoined,
			Payload: `{"peer":{"peer_id":"peer"}}`,
			Urgent:  false,
			Read:    false,
		}
		s.Require().NoError(s.store.SaveEvent(ctx, event))
	}

	// Mark 2 as read
	s.Require().NoError(s.store.MarkEventRead(ctx, "evt-000"))
	s.Require().NoError(s.store.MarkEventRead(ctx, "evt-001"))

	count, err := s.store.GetPendingEventsCount(ctx)
	s.NoError(err)
	s.Equal(3, count)
}
```

Add the required imports at the top of `events_test.go`:

```go
import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/suite"
)
```

**Step 2: Run test — expect compilation failure**

Run: `go test -run TestEventStoreSuite -v ./...`
Expected: Compilation error — `StoredEvent`, `SaveEvent`, etc. undefined.

**Step 3: Add StoredEvent type to events.go**

Append to `events.go`:

```go
// StoredEvent is the persisted form of a NodeEvent in the events table.
type StoredEvent struct {
	ID        string    `json:"id"`
	Kind      EventKind `json:"kind"`
	Payload   string    `json:"payload"`
	Urgent    bool      `json:"urgent"`
	Read      bool      `json:"read"`
	CreatedAt time.Time `json:"created_at"`
}
```

**Step 4: Add events table to schema**

In `store.go:141-157`, add the events table before the CREATE INDEX statements. Insert after the `reconciliation_log` table (after line 149):

```sql
	CREATE TABLE IF NOT EXISTS events (
		id         TEXT PRIMARY KEY,
		kind       TEXT NOT NULL,
		payload    TEXT NOT NULL,
		urgent     INTEGER DEFAULT 0,
		read       INTEGER DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_events_read ON events(read);
	CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
```

**Step 5: Add event CRUD methods to store.go**

Append to `store.go`:

```go
func (s *Store) SaveEvent(ctx context.Context, event *StoredEvent) error {
	if event.ID == "" {
		event.ID = uuid.New().String()
	}
	event.CreatedAt = time.Now()
	urgent := 0
	if event.Urgent {
		urgent = 1
	}
	read := 0
	if event.Read {
		read = 1
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO events (id, kind, payload, urgent, read, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		event.ID, event.Kind, event.Payload, urgent, read, event.CreatedAt)
	return err
}

func (s *Store) GetPendingEvents(ctx context.Context) ([]StoredEvent, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, kind, payload, urgent, read, created_at FROM events WHERE read = 0 ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []StoredEvent
	for rows.Next() {
		var e StoredEvent
		var urgent, read int
		if err := rows.Scan(&e.ID, &e.Kind, &e.Payload, &urgent, &read, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.Urgent = urgent == 1
		e.Read = read == 1
		events = append(events, e)
	}
	return events, rows.Err()
}

func (s *Store) GetPendingEventsCount(ctx context.Context) (int, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM events WHERE read = 0`).Scan(&count)
	return count, err
}

func (s *Store) MarkEventRead(ctx context.Context, eventID string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE events SET read = 1 WHERE id = ?`, eventID)
	return err
}

func (s *Store) MarkEventsRead(ctx context.Context, eventIDs []string) error {
	if len(eventIDs) == 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `UPDATE events SET read = 1 WHERE id = ?`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, id := range eventIDs {
		if _, err := stmt.ExecContext(ctx, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) PruneOldEvents(ctx context.Context, olderThanDays int) (int, error) {
	result, err := s.db.ExecContext(ctx,
		`DELETE FROM events WHERE created_at < datetime('now', '-' || ? || ' days')`, olderThanDays)
	if err != nil {
		return 0, err
	}
	affected, err := result.RowsAffected()
	return int(affected), err
}
```

**Step 6: Run test — expect pass**

Run: `go test -run TestEventStoreSuite -v ./...`
Expected: All 5 tests pass.

**Step 7: Commit**

```bash
git add events.go events_test.go store.go
git commit -m "feat: add events SQLite table with save, read, mark, prune operations"
```

---

## Task 3: Event Dispatcher — Bridge P2P Handlers to MCP Notifications

**Files:**
- Create: `event_dispatcher.go`

**Step 1: Write failing test**

Create `event_dispatcher_test.go`:

```go
package main

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/suite"
)

type EventDispatcherSuite struct {
	suite.Suite
	store      *Store
	dispatcher *EventDispatcher
}

func TestEventDispatcherSuite(t *testing.T) {
	suite.Run(t, new(EventDispatcherSuite))
}

func (s *EventDispatcherSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store

	logger := zerolog.Nop()
	// No MCP server in tests — dispatcher should still persist events
	s.dispatcher = NewEventDispatcher(s.store, nil, logger)
}

func (s *EventDispatcherSuite) TearDownTest() {
	s.store.Close()
}

func (s *EventDispatcherSuite) TestDispatchPersistsEvent() {
	ctx := context.Background()

	event := NodeEvent{
		Kind:      EventChallengeReceived,
		Timestamp: time.Now(),
		Urgent:    true,
		Payload: EventPayload{
			Challenge: &ChallengeEventData{
				ChallengeID: "ch-001",
				Kind:        "weak_evidence",
				FromPeer:    "peer-qa",
				TargetItem:  "item-auth",
				Reason:      "Test coverage low",
				Deadline:    time.Now().Add(24 * time.Hour),
			},
		},
	}

	err := s.dispatcher.Dispatch(ctx, event)
	s.NoError(err)

	// Verify event was persisted
	pending, err := s.store.GetPendingEvents(ctx)
	s.NoError(err)
	s.Len(pending, 1)
	s.Equal(EventChallengeReceived, pending[0].Kind)
	s.True(pending[0].Urgent)

	// Verify payload is valid JSON
	var payload EventPayload
	err = json.Unmarshal([]byte(pending[0].Payload), &payload)
	s.NoError(err)
	s.NotNil(payload.Challenge)
	s.Equal("ch-001", payload.Challenge.ChallengeID)
}

func (s *EventDispatcherSuite) TestDispatchSetsUrgentFromEventKind() {
	ctx := context.Background()

	// Dispatch an urgent event kind
	err := s.dispatcher.Dispatch(ctx, NodeEvent{
		Kind:      EventVoteRequested,
		Timestamp: time.Now(),
		Urgent:    true,
		Payload: EventPayload{
			Proposal: &ProposalEventData{
				ProposalID: "prop-001",
				Kind:       "cr",
				Title:      "Switch to WebSocket",
			},
		},
	})
	s.NoError(err)

	// Dispatch a non-urgent event kind
	err = s.dispatcher.Dispatch(ctx, NodeEvent{
		Kind:      EventPeerJoined,
		Timestamp: time.Now(),
		Urgent:    false,
		Payload: EventPayload{
			Peer: &PeerEventData{
				PeerID: "peer-123",
				Name:   "dev-node",
			},
		},
	})
	s.NoError(err)

	pending, err := s.store.GetPendingEvents(ctx)
	s.NoError(err)
	s.Len(pending, 2)
	s.True(pending[0].Urgent)
	s.False(pending[1].Urgent)
}

func (s *EventDispatcherSuite) TestDispatchWithoutMCPServer() {
	ctx := context.Background()

	// dispatcher was created without MCP server (nil)
	// Should still persist without error
	event := NodeEvent{
		Kind:      EventPeerLost,
		Timestamp: time.Now(),
		Urgent:    false,
		Payload: EventPayload{
			Peer: &PeerEventData{
				PeerID:   "peer-456",
				Name:     "qa-node",
				LastSeen: "2026-03-18T10:00:00Z",
			},
		},
	}

	err := s.dispatcher.Dispatch(ctx, event)
	s.NoError(err)

	pending, err := s.store.GetPendingEvents(ctx)
	s.NoError(err)
	s.Len(pending, 1)
}

func (s *EventDispatcherSuite) TestDispatchMultipleEvents() {
	ctx := context.Background()

	kinds := []EventKind{
		EventChallengeReceived,
		EventVoteRequested,
		EventPeerJoined,
		EventQueryReceived,
		EventSweepReceived,
	}

	for _, kind := range kinds {
		err := s.dispatcher.Dispatch(ctx, NodeEvent{
			Kind:      kind,
			Timestamp: time.Now(),
			Urgent:    IsUrgentEvent(kind),
			Payload: EventPayload{
				Peer: &PeerEventData{PeerID: "peer-test", Name: "test"},
			},
		})
		s.NoError(err)
	}

	pending, err := s.store.GetPendingEvents(ctx)
	s.NoError(err)
	s.Len(pending, 5)
}
```

**Step 2: Run test — expect compilation failure**

Run: `go test -run TestEventDispatcherSuite -v ./...`
Expected: Compilation error — `EventDispatcher`, `NewEventDispatcher` undefined.

**Step 3: Implement EventDispatcher**

Create `event_dispatcher.go`:

```go
package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/mark3labs/mcp-go/server"
	"github.com/rs/zerolog"
)

// EventDispatcher persists events to SQLite and optionally pushes them
// to Claude Code via MCP SendNotificationToClient.
type EventDispatcher struct {
	store     *Store
	mcpServer *server.MCPServer
	logger    zerolog.Logger
}

// NewEventDispatcher creates a new EventDispatcher.
// mcpServer may be nil (e.g., in tests or when running without MCP).
func NewEventDispatcher(store *Store, mcpServer *server.MCPServer, logger zerolog.Logger) *EventDispatcher {
	return &EventDispatcher{
		store:     store,
		mcpServer: mcpServer,
		logger:    logger,
	}
}

// Dispatch persists a NodeEvent to SQLite, then sends an MCP notification
// if an MCP server is available.
// MCP notification uses a single "inventory/event" channel name.
// The event kind is included in the notification payload for client-side routing.
func (d *EventDispatcher) Dispatch(ctx context.Context, event NodeEvent) error {
	payloadJSON, err := json.Marshal(event.Payload)
	if err != nil {
		return fmt.Errorf("marshal event payload: %w", err)
	}

	stored := &StoredEvent{
		ID:      uuid.New().String(),
		Kind:    event.Kind,
		Payload: string(payloadJSON),
		Urgent:  event.Urgent,
		Read:    false,
	}

	if err := d.store.SaveEvent(ctx, stored); err != nil {
		return fmt.Errorf("save event: %w", err)
	}

	d.logger.Info().
		Str("event_id", stored.ID).
		Str("kind", string(event.Kind)).
		Bool("urgent", event.Urgent).
		Msg("event dispatched")

	if d.mcpServer != nil {
		notifData := map[string]string{
			"event_id":  stored.ID,
			"kind":      string(event.Kind),
			"payload":   string(payloadJSON),
			"urgent":    fmt.Sprintf("%t", event.Urgent),
			"timestamp": event.Timestamp.Format("2006-01-02T15:04:05Z07:00"),
		}
		if err := d.mcpServer.SendNotificationToClient(ctx, "inventory/event", notifData); err != nil {
			d.logger.Warn().Err(err).Str("event_id", stored.ID).Msg("failed to send MCP notification, event persisted")
			// Don't return error — event is persisted, MCP push is best-effort
		}
	}

	return nil
}
```

**Step 4: Run test — expect pass**

Run: `go test -run TestEventDispatcherSuite -v ./...`
Expected: All 4 tests pass.

**Step 5: Add EventDispatcher to DI graph**

In `graph.go`, add the `EventDispatcherProvider` after `NetworkEngine`:

```go
var EventDispatcherProvider = pumped.Derive2(
	DBStore,
	NetworkEngine,
	func(ctx *pumped.ResolveCtx, storeCtrl *pumped.Controller[*Store], engineCtrl *pumped.Controller[*Engine]) (*EventDispatcher, error) {
		store, err := storeCtrl.Get()
		if err != nil {
			return nil, fmt.Errorf("failed to get store: %w", err)
		}
		// Engine is resolved to ensure store is migrated, but we don't use it directly here
		if _, err := engineCtrl.Get(); err != nil {
			return nil, fmt.Errorf("failed to get engine: %w", err)
		}

		logger := zerolog.Nop() // Will be replaced with proper logger when zerolog DI is added
		// MCP server is nil here — it gets set when `inv serve` starts
		return NewEventDispatcher(store, nil, logger), nil
	},
)
```

**Step 6: Verify compilation**

Run: `go build ./...`
Expected: No errors.

**Step 7: Commit**

```bash
git add event_dispatcher.go event_dispatcher_test.go graph.go
git commit -m "feat: add EventDispatcher that persists events and sends MCP notifications"
```

---

## Task 4: P2P Handler Integration — Emit Events from Message Handlers

**Files:**
- Modify: `p2p_handlers.go` (add `dispatcher *EventDispatcher` field, emit events from all handlers)

**Prerequisite:** P2P implementation must be complete. `p2p_handlers.go` exists with handler methods for each message type.

**Step 1: Write failing test**

Append to `event_dispatcher_test.go`:

```go
type P2PEventIntegrationSuite struct {
	suite.Suite
	store      *Store
	dispatcher *EventDispatcher
}

func TestP2PEventIntegrationSuite(t *testing.T) {
	suite.Run(t, new(P2PEventIntegrationSuite))
}

func (s *P2PEventIntegrationSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store

	logger := zerolog.Nop()
	s.dispatcher = NewEventDispatcher(s.store, nil, logger)
}

func (s *P2PEventIntegrationSuite) TearDownTest() {
	s.store.Close()
}

func (s *P2PEventIntegrationSuite) TestChallengeReceivedEvent() {
	ctx := context.Background()

	event := NodeEvent{
		Kind:      EventChallengeReceived,
		Timestamp: time.Now(),
		Urgent:    true,
		Payload: EventPayload{
			Challenge: &ChallengeEventData{
				ChallengeID: "ch-001",
				Kind:        "weak_evidence",
				FromPeer:    "peer-qa",
				TargetItem:  "item-auth",
				Reason:      "Coverage below threshold",
				Deadline:    time.Now().Add(24 * time.Hour),
			},
		},
	}

	err := s.dispatcher.Dispatch(ctx, event)
	s.NoError(err)

	pending, err := s.store.GetPendingEvents(ctx)
	s.NoError(err)
	s.Len(pending, 1)
	s.Equal(EventChallengeReceived, pending[0].Kind)
	s.True(pending[0].Urgent)
}

func (s *P2PEventIntegrationSuite) TestVoteRequestedEvent() {
	ctx := context.Background()

	event := NodeEvent{
		Kind:      EventVoteRequested,
		Timestamp: time.Now(),
		Urgent:    true,
		Payload: EventPayload{
			Proposal: &ProposalEventData{
				ProposalID: "prop-001",
				Kind:       "cr",
				Title:      "Switch to WebSocket",
				Deadline:   "2026-03-20T00:00:00Z",
			},
		},
	}

	err := s.dispatcher.Dispatch(ctx, event)
	s.NoError(err)

	pending, err := s.store.GetPendingEvents(ctx)
	s.NoError(err)
	s.Len(pending, 1)
	s.Equal(EventVoteRequested, pending[0].Kind)
}

func (s *P2PEventIntegrationSuite) TestMembershipRequestEvent() {
	ctx := context.Background()

	event := NodeEvent{
		Kind:      EventMembershipRequest,
		Timestamp: time.Now(),
		Urgent:    true,
		Payload: EventPayload{
			Membership: &MembershipEventData{
				PeerID:   "peer-new",
				Name:     "alex-devops",
				Vertical: "devops",
			},
		},
	}

	err := s.dispatcher.Dispatch(ctx, event)
	s.NoError(err)

	pending, err := s.store.GetPendingEvents(ctx)
	s.NoError(err)
	s.Len(pending, 1)
	s.Equal(EventMembershipRequest, pending[0].Kind)
	s.True(pending[0].Urgent)
}

func (s *P2PEventIntegrationSuite) TestSignalReceivedEvent() {
	ctx := context.Background()

	event := NodeEvent{
		Kind:      EventSignalReceived,
		Timestamp: time.Now(),
		Urgent:    true,
		Payload: EventPayload{
			Signal: &SignalEventData{
				ItemID:     "item-adr",
				SourceItem: "item-us003",
				Reason:     "Upstream user story changed",
			},
		},
	}

	err := s.dispatcher.Dispatch(ctx, event)
	s.NoError(err)

	pending, err := s.store.GetPendingEvents(ctx)
	s.NoError(err)
	s.Len(pending, 1)
	s.Equal(EventSignalReceived, pending[0].Kind)
}

func (s *P2PEventIntegrationSuite) TestQueryReceivedEvent() {
	ctx := context.Background()

	event := NodeEvent{
		Kind:      EventQueryReceived,
		Timestamp: time.Now(),
		Urgent:    false,
		Payload: EventPayload{
			Query: &QueryEventData{
				QueryID:  "q-001",
				Question: "What implements US-003?",
				Asker:    "pm-node",
			},
		},
	}

	err := s.dispatcher.Dispatch(ctx, event)
	s.NoError(err)

	pending, err := s.store.GetPendingEvents(ctx)
	s.NoError(err)
	s.Len(pending, 1)
	s.Equal(EventQueryReceived, pending[0].Kind)
	s.False(pending[0].Urgent)
}

func (s *P2PEventIntegrationSuite) TestSweepReceivedEvent() {
	ctx := context.Background()

	event := NodeEvent{
		Kind:      EventSweepReceived,
		Timestamp: time.Now(),
		Urgent:    false,
		Payload: EventPayload{
			Sweep: &SweepEventData{
				ExternalRef:  "HIPAA-2026-update",
				MatchedItems: []string{"item-001", "item-002"},
			},
		},
	}

	err := s.dispatcher.Dispatch(ctx, event)
	s.NoError(err)

	pending, err := s.store.GetPendingEvents(ctx)
	s.NoError(err)
	s.Len(pending, 1)
	s.Equal(EventSweepReceived, pending[0].Kind)
}
```

**Step 2: Run test — expect pass**

Run: `go test -run TestP2PEventIntegrationSuite -v ./...`
Expected: All 6 tests pass (these use the already-implemented dispatcher).

**Step 3: Modify P2P handlers to accept and use EventDispatcher**

In `p2p_handlers.go`, add `dispatcher *EventDispatcher` to the `P2PHandlers` struct:

```go
type P2PHandlers struct {
	store      *Store
	engine     *Engine
	dispatcher *EventDispatcher
	// ... other existing fields
}
```

In each handler method, after processing the message, call `h.dispatcher.Dispatch(...)`:

Example for `HandleChallengeCreate`:
```go
func (h *P2PHandlers) HandleChallengeCreate(ctx context.Context, env *pb.Envelope) error {
	challenge := env.GetChallengeCreate()

	// ... existing logic to save challenge ...

	h.dispatcher.Dispatch(ctx, NodeEvent{
		Kind:      EventChallengeReceived,
		Timestamp: time.Now(),
		Urgent:    true,
		Payload: EventPayload{
			Challenge: &ChallengeEventData{
				ChallengeID: challenge.ChallengeId,
				Kind:        challenge.Kind,
				FromPeer:    challenge.ChallengerPeer,
				TargetItem:  challenge.TargetItemId,
				Reason:      challenge.Reason,
				Deadline:    time.Now().Add(time.Duration(challenge.DeadlineSeconds) * time.Second),
			},
		},
	})

	return nil
}
```

Repeat for all handlers:
- `HandleChallengeResult` → `EventChallengeResult` (urgent: false)
- `HandleProposalCreate` / `HandleVoteRequest` → `EventVoteRequested` (urgent: true)
- `HandleProposalResult` → `EventProposalResult` (urgent: false)
- `HandleMembershipRequest` → `EventMembershipRequest` (urgent: true)
- `HandlePeerJoined` → `EventPeerJoined` (urgent: false)
- `HandlePeerLost` → `EventPeerLost` (urgent: false)
- `HandleSignalForward` → `EventSignalReceived` (urgent: true)
- `HandleQueryForward` → `EventQueryReceived` (urgent: false)
- `HandleSweepBroadcast` → `EventSweepReceived` (urgent: false)

**Step 4: Verify compilation**

Run: `go build ./...`
Expected: No errors.

**Step 5: Commit**

```bash
git add p2p_handlers.go event_dispatcher_test.go
git commit -m "feat: emit events from all P2P message handlers via EventDispatcher"
```

---

## Task 5: `inv_pending_events` MCP Tool

**Files:**
- Modify: `mcp_server.go` (add `inv_pending_events` tool)
- Modify: `engine.go` (add `GetPendingEvents`, `AcknowledgeEvents` methods)

**Step 1: Write failing test**

Append to `events_test.go`:

```go
type PendingEventsSuite struct {
	suite.Suite
	store  *Store
	engine *Engine
}

func TestPendingEventsSuite(t *testing.T) {
	suite.Run(t, new(PendingEventsSuite))
}

func (s *PendingEventsSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store

	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	s.engine = NewEngine(store, prop, crsm)
}

func (s *PendingEventsSuite) TearDownTest() {
	s.store.Close()
}

func (s *PendingEventsSuite) TestGetPendingEventsReturnsUnread() {
	ctx := context.Background()

	// Save 3 events
	for i := 0; i < 3; i++ {
		s.Require().NoError(s.store.SaveEvent(ctx, &StoredEvent{
			ID:      fmt.Sprintf("evt-%03d", i),
			Kind:    EventPeerJoined,
			Payload: `{"peer":{"peer_id":"peer"}}`,
			Urgent:  false,
			Read:    false,
		}))
	}
	// Mark one as read
	s.Require().NoError(s.store.MarkEventRead(ctx, "evt-001"))

	events, err := s.engine.GetPendingEvents(ctx)
	s.NoError(err)
	s.Len(events, 2)
}

func (s *PendingEventsSuite) TestAcknowledgeEventsMarksRead() {
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		s.Require().NoError(s.store.SaveEvent(ctx, &StoredEvent{
			ID:      fmt.Sprintf("evt-%03d", i),
			Kind:    EventPeerJoined,
			Payload: `{"peer":{"peer_id":"peer"}}`,
			Urgent:  false,
			Read:    false,
		}))
	}

	err := s.engine.AcknowledgeEvents(ctx, []string{"evt-000", "evt-002"})
	s.NoError(err)

	pending, err := s.engine.GetPendingEvents(ctx)
	s.NoError(err)
	s.Len(pending, 1)
	s.Equal("evt-001", pending[0].ID)
}
```

**Step 2: Run test — expect compilation failure**

Run: `go test -run TestPendingEventsSuite -v ./...`
Expected: Compilation error — `GetPendingEvents`, `AcknowledgeEvents` undefined on Engine.

**Step 3: Add Engine methods**

Append to `engine.go`:

```go
// GetPendingEvents returns all unread events, ordered by creation time.
func (e *Engine) GetPendingEvents(ctx context.Context) ([]StoredEvent, error) {
	return e.store.GetPendingEvents(ctx)
}

// AcknowledgeEvents marks the given event IDs as read.
func (e *Engine) AcknowledgeEvents(ctx context.Context, eventIDs []string) error {
	return e.store.MarkEventsRead(ctx, eventIDs)
}
```

**Step 4: Run test — expect pass**

Run: `go test -run TestPendingEventsSuite -v ./...`
Expected: All 2 tests pass.

**Step 5: Add MCP tool**

In `mcp_server.go`, add before the final `return server.ServeStdio(s)` (before line 220):

```go
s.AddTool(mcp.NewTool("inv_pending_events",
	mcp.WithDescription("Get all pending (unread) events that need attention. Returns events ordered by time. Call at session start or reconnect to catch up on missed events."),
	mcp.WithBoolean("acknowledge", mcp.Description("If true, marks returned events as read after retrieval (default: true)")),
), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	events, err := engine.GetPendingEvents(ctx)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	// Default: acknowledge (mark as read)
	acknowledge := true
	if v, ok := req.GetArguments()["acknowledge"].(bool); ok {
		acknowledge = v
	}

	if acknowledge && len(events) > 0 {
		ids := make([]string, len(events))
		for i, e := range events {
			ids[i] = e.ID
		}
		if err := engine.AcknowledgeEvents(ctx, ids); err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("events retrieved but acknowledge failed: %v", err)), nil
		}
	}

	return resultJSON(events)
})
```

**Step 6: Verify compilation**

Run: `go build ./...`
Expected: No errors.

**Step 7: Commit**

```bash
git add engine.go mcp_server.go events_test.go
git commit -m "feat: add inv_pending_events MCP tool for session start/reconnect catch-up"
```

---

## Task 6: `inv_session_status` MCP Tool — Combined Status for Session Start

**Files:**
- Modify: `engine.go` (add `SessionStatus` type and `GetSessionStatus` method)
- Modify: `mcp_server.go` (add `inv_session_status` tool)

**Step 1: Write failing test**

Append to `events_test.go`:

```go
type SessionStatusSuite struct {
	suite.Suite
	store  *Store
	engine *Engine
}

func TestSessionStatusSuite(t *testing.T) {
	suite.Run(t, new(SessionStatusSuite))
}

func (s *SessionStatusSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store

	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	s.engine = NewEngine(store, prop, crsm)
}

func (s *SessionStatusSuite) TearDownTest() {
	s.store.Close()
}

func (s *SessionStatusSuite) TestSessionStatusEmpty() {
	ctx := context.Background()

	// Register a node first
	node, err := s.engine.RegisterNode(ctx, "dev-inv", VerticalDev, "clinic-checkin", "cuong", false)
	s.Require().NoError(err)

	status, err := s.engine.GetSessionStatus(ctx, "clinic-checkin", node.ID)
	s.NoError(err)

	s.Equal(node.ID, status.MyNode.ID)
	s.Len(status.Nodes, 1)
	s.Empty(status.SuspectItems)
	s.Empty(status.BrokenItems)
	s.Empty(status.PendingCRs)
	s.Empty(status.ActiveChallenges)
	s.Equal(0, status.PendingEvents)
}

func (s *SessionStatusSuite) TestSessionStatusWithData() {
	ctx := context.Background()

	// Register nodes
	devNode, err := s.engine.RegisterNode(ctx, "dev-inv", VerticalDev, "clinic-checkin", "cuong", false)
	s.Require().NoError(err)
	_, err = s.engine.RegisterNode(ctx, "pm-inv", VerticalPM, "clinic-checkin", "duke", false)
	s.Require().NoError(err)

	// Add items in different states
	item1, err := s.engine.AddItem(ctx, devNode.ID, KindADR, "Auth design", "", "")
	s.Require().NoError(err)

	// Verify item1 then make it suspect
	err = s.engine.VerifyItem(ctx, item1.ID, "Tests pass", "cuong")
	s.Require().NoError(err)
	// Make suspect by propagating (we'll manually update for test)
	_, err = s.store.db.ExecContext(ctx, `UPDATE items SET status = 'suspect' WHERE id = ?`, item1.ID)
	s.Require().NoError(err)

	item2, err := s.engine.AddItem(ctx, devNode.ID, KindAPISpec, "Auth API", "", "")
	s.Require().NoError(err)
	// Mark broken
	err = s.engine.VerifyItem(ctx, item2.ID, "Initial pass", "cuong")
	s.Require().NoError(err)
	err = s.engine.MarkBroken(ctx, item2.ID, "Broke after refactor", "cuong")
	s.Require().NoError(err)

	// Create a pending CR
	_, err = s.engine.CreateCR(ctx, "Switch to WebSocket", "Better perf", "cuong", devNode.ID, []string{item1.ID})
	s.Require().NoError(err)

	// Add pending events
	s.Require().NoError(s.store.SaveEvent(ctx, &StoredEvent{
		ID:      "evt-001",
		Kind:    EventChallengeReceived,
		Payload: `{"challenge":{"challenge_id":"ch-001"}}`,
		Urgent:  true,
		Read:    false,
	}))

	// Get session status
	status, err := s.engine.GetSessionStatus(ctx, "clinic-checkin", devNode.ID)
	s.NoError(err)

	s.Len(status.Nodes, 2)
	s.Equal(devNode.ID, status.MyNode.ID)
	s.Len(status.SuspectItems, 1)
	s.Len(status.BrokenItems, 1)
	s.Len(status.PendingCRs, 1)
	s.Equal(1, status.PendingEvents)
	s.NotNil(status.AuditReport)
}

func (s *SessionStatusSuite) TestSessionStatusJSON() {
	ctx := context.Background()

	node, err := s.engine.RegisterNode(ctx, "dev-inv", VerticalDev, "clinic-checkin", "cuong", false)
	s.Require().NoError(err)

	status, err := s.engine.GetSessionStatus(ctx, "clinic-checkin", node.ID)
	s.NoError(err)

	data, err := json.Marshal(status)
	s.NoError(err)

	var decoded SessionStatus
	err = json.Unmarshal(data, &decoded)
	s.NoError(err)
	s.Equal(node.ID, decoded.MyNode.ID)
}
```

**Step 2: Run test — expect compilation failure**

Run: `go test -run TestSessionStatusSuite -v ./...`
Expected: Compilation error — `SessionStatus`, `GetSessionStatus` undefined.

**Step 3: Add SessionStatus type and Engine method**

Append to `engine.go`:

```go
// SessionStatus provides a comprehensive snapshot for Claude Code session start.
// One MCP call gives the AI agent full situational awareness.
type SessionStatus struct {
	Nodes             []Node          `json:"nodes"`
	MyNode            Node            `json:"my_node"`
	SuspectItems      []Item          `json:"suspect_items"`
	BrokenItems       []Item          `json:"broken_items"`
	PendingCRs        []ChangeRequest `json:"pending_crs"`
	ActiveChallenges  []Challenge     `json:"active_challenges"`
	UnansweredQueries []Query         `json:"unanswered_queries"`
	AuditReport       *AuditReport    `json:"audit_report"`
	PendingEvents     int             `json:"pending_events"`
}

// GetSessionStatus returns a combined status snapshot for session start.
// Returns all nodes, actionable items, pending governance, and audit report.
func (e *Engine) GetSessionStatus(ctx context.Context, project string, myNodeID string) (*SessionStatus, error) {
	myNode, err := e.store.GetNode(ctx, myNodeID)
	if err != nil {
		return nil, fmt.Errorf("get my node: %w", err)
	}

	nodes, err := e.store.ListNodes(ctx, project)
	if err != nil {
		return nil, fmt.Errorf("list nodes: %w", err)
	}

	suspectItems, err := e.store.GetItemsByNodeAndStatus(ctx, myNodeID, StatusSuspect)
	if err != nil {
		return nil, fmt.Errorf("get suspect items: %w", err)
	}

	brokenItems, err := e.store.GetItemsByNodeAndStatus(ctx, myNodeID, StatusBroke)
	if err != nil {
		return nil, fmt.Errorf("get broken items: %w", err)
	}

	pendingCRs, err := e.store.GetPendingCRs(ctx, myNodeID)
	if err != nil {
		return nil, fmt.Errorf("get pending CRs: %w", err)
	}

	unansweredQueries, err := e.store.GetUnansweredQueries(ctx, myNodeID)
	if err != nil {
		return nil, fmt.Errorf("get unanswered queries: %w", err)
	}

	activeChallenges, err := e.store.ListChallengesByPeer(ctx, myNodeID, true)
	if err != nil {
		return nil, fmt.Errorf("get active challenges: %w", err)
	}
	// Filter to only open/responded challenges (active ones)
	var activeOnly []Challenge
	for _, ch := range activeChallenges {
		if ch.Status == ChallengeOpen || ch.Status == ChallengeResponded {
			activeOnly = append(activeOnly, ch)
		}
	}

	auditReport, err := e.store.AuditNode(ctx, myNodeID)
	if err != nil {
		return nil, fmt.Errorf("audit node: %w", err)
	}

	pendingEventsCount, err := e.store.GetPendingEventsCount(ctx)
	if err != nil {
		return nil, fmt.Errorf("get pending events count: %w", err)
	}

	return &SessionStatus{
		Nodes:             nodes,
		MyNode:            *myNode,
		SuspectItems:      suspectItems,
		BrokenItems:       brokenItems,
		PendingCRs:        pendingCRs,
		ActiveChallenges:  activeOnly,
		UnansweredQueries: unansweredQueries,
		AuditReport:       auditReport,
		PendingEvents:     pendingEventsCount,
	}, nil
}
```

**Step 4: Add Store helper methods**

Append to `store.go`:

```go
// GetPendingCRs returns change requests that are in voting state or proposed
// (actionable CRs that the node should be aware of).
func (s *Store) GetPendingCRs(ctx context.Context, nodeID string) ([]ChangeRequest, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, title, description, proposer_id, node_id, status, affected_items, created_at, updated_at
		 FROM change_requests WHERE status IN ('proposed', 'voting') ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var crs []ChangeRequest
	for rows.Next() {
		var cr ChangeRequest
		var affected string
		if err := rows.Scan(&cr.ID, &cr.Title, &cr.Description, &cr.ProposerID, &cr.NodeID, &cr.Status, &affected, &cr.CreatedAt, &cr.UpdatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(affected), &cr.AffectedItems)
		crs = append(crs, cr)
	}
	return crs, rows.Err()
}

// GetUnansweredQueries returns queries directed at the given node (or broadcast)
// that have not been resolved.
func (s *Store) GetUnansweredQueries(ctx context.Context, nodeID string) ([]Query, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, asker_id, asker_node, question, context, target_node, resolved, created_at
		 FROM queries WHERE resolved = 0 AND (target_node = ? OR target_node = '') ORDER BY created_at`,
		nodeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var queries []Query
	for rows.Next() {
		var q Query
		if err := rows.Scan(&q.ID, &q.AskerID, &q.AskerNode, &q.Question, &q.Context, &q.TargetNode, &q.Resolved, &q.CreatedAt); err != nil {
			return nil, err
		}
		queries = append(queries, q)
	}
	return queries, rows.Err()
}
```

**Note:** `GetItemsByNodeAndStatus` already exists in `store.go`. Phase 2 (Task 1) updates it to include the `external_ref` column. No changes needed here — just call the existing method.

**Step 5: Run test — expect pass**

Run: `go test -run TestSessionStatusSuite -v ./...`
Expected: All 3 tests pass.

**Step 6: Add MCP tool**

In `mcp_server.go`, add before `return server.ServeStdio(s)`:

```go
s.AddTool(mcp.NewTool("inv_session_status",
	mcp.WithDescription("Get comprehensive session status for Claude Code session start. Returns nodes, suspect/broken items, pending CRs, unanswered queries, audit report, and pending event count. Call this first when starting a session."),
	mcp.WithString("project", mcp.Required(), mcp.Description("Project name")),
	mcp.WithString("node_id", mcp.Required(), mcp.Description("Your node ID")),
), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	project, _ := req.RequireString("project")
	nodeID, _ := req.RequireString("node_id")

	status, err := engine.GetSessionStatus(ctx, project, nodeID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return resultJSON(status)
})
```

**Step 7: Verify compilation**

Run: `go build ./...`
Expected: No errors.

**Step 8: Commit**

```bash
git add engine.go store.go mcp_server.go events_test.go
git commit -m "feat: add inv_session_status MCP tool for comprehensive session start awareness"
```

---

## Task 7: Permission Mode — Action Matrix + Config Command

**Prerequisite:** `PermissionMode` type and `permission_mode` config field already exist from P2P implementation (defined in `config.go` with `PermissionNormal` and `PermissionAutonomous` constants). The `--mode` flag on `inv serve` and `inv init` also already exists. This task adds the **action-level permission matrix** and the `inv config` CLI command.

**Files:**
- Create: `permission.go` (action kinds, permission matrix, RequiresHumanConfirmation)
- Modify: `main.go` (add `inv config set/get` command)

**Step 1: Write failing test**

Append to `events_test.go`:

```go
type PermissionModeSuite struct {
	suite.Suite
}

func TestPermissionModeSuite(t *testing.T) {
	suite.Run(t, new(PermissionModeSuite))
}

func (s *PermissionModeSuite) TestPermissionModeValidation() {
	s.True(IsValidPermissionMode(PermissionNormal))
	s.True(IsValidPermissionMode(PermissionAutonomous))
	s.False(IsValidPermissionMode(PermissionMode("invalid")))
	s.False(IsValidPermissionMode(PermissionMode("")))
}

func (s *PermissionModeSuite) TestRequiresHumanConfirmation() {
	// Governance actions always require human regardless of mode
	s.True(RequiresHumanConfirmation(PermissionNormal, ActionFileChallenge))
	s.True(RequiresHumanConfirmation(PermissionAutonomous, ActionFileChallenge))
	s.True(RequiresHumanConfirmation(PermissionNormal, ActionVoteHuman))
	s.True(RequiresHumanConfirmation(PermissionAutonomous, ActionVoteHuman))
	s.True(RequiresHumanConfirmation(PermissionNormal, ActionRespondChallenge))
	s.True(RequiresHumanConfirmation(PermissionAutonomous, ActionRespondChallenge))
	s.True(RequiresHumanConfirmation(PermissionNormal, ActionAcceptMembership))
	s.True(RequiresHumanConfirmation(PermissionAutonomous, ActionAcceptMembership))

	// Autonomous actions: require human in normal mode, free in autonomous
	s.True(RequiresHumanConfirmation(PermissionNormal, ActionAddItem))
	s.False(RequiresHumanConfirmation(PermissionAutonomous, ActionAddItem))
	s.True(RequiresHumanConfirmation(PermissionNormal, ActionVerifyItem))
	s.False(RequiresHumanConfirmation(PermissionAutonomous, ActionVerifyItem))
	s.True(RequiresHumanConfirmation(PermissionNormal, ActionRespondQuery))
	s.False(RequiresHumanConfirmation(PermissionAutonomous, ActionRespondQuery))
	s.True(RequiresHumanConfirmation(PermissionNormal, ActionMarkBroken))
	s.False(RequiresHumanConfirmation(PermissionAutonomous, ActionMarkBroken))
	s.True(RequiresHumanConfirmation(PermissionNormal, ActionCreateTrace))
	s.False(RequiresHumanConfirmation(PermissionAutonomous, ActionCreateTrace))

	// Always autonomous: never require human in either mode
	s.False(RequiresHumanConfirmation(PermissionNormal, ActionPropagateSignal))
	s.False(RequiresHumanConfirmation(PermissionAutonomous, ActionPropagateSignal))
	s.False(RequiresHumanConfirmation(PermissionNormal, ActionCastAIVote))
	s.False(RequiresHumanConfirmation(PermissionAutonomous, ActionCastAIVote))
	s.False(RequiresHumanConfirmation(PermissionNormal, ActionAskNetwork))
	s.False(RequiresHumanConfirmation(PermissionAutonomous, ActionAskNetwork))
}
```

**Step 2: Run test — expect compilation failure**

Run: `go test -run TestPermissionModeSuite -v ./...`
Expected: Compilation error — `IsValidPermissionMode`, `ActionKind`, etc. undefined.

**Step 3: Implement permission matrix**

Create `permission.go`:

```go
package main

// IsValidPermissionMode returns true if the mode is a recognized value.
// PermissionMode type is defined in config.go (from P2P implementation).
func IsValidPermissionMode(mode PermissionMode) bool {
	return mode == PermissionNormal || mode == PermissionAutonomous
}

// ActionKind categorizes inventory actions for permission checks.
type ActionKind string

const (
	// Always require human confirmation (both modes)
	// These are governance actions that affect the whole network.
	ActionFileChallenge    ActionKind = "file_challenge"      // File a challenge against another node
	ActionVoteHuman        ActionKind = "vote_human"          // Cast a human-weight vote on proposals
	ActionRespondChallenge ActionKind = "respond_challenge"   // Respond to a challenge against your node
	ActionAcceptMembership ActionKind = "accept_membership"   // Approve/reject a new node joining

	// Require human in normal mode, autonomous in autonomous mode
	// These operate on your own node's data only.
	ActionAddItem      ActionKind = "add_item"       // Add item to own inventory
	ActionVerifyItem   ActionKind = "verify_item"    // Verify an item with evidence
	ActionMarkBroken   ActionKind = "mark_broken"    // Mark an item as broken
	ActionCreateTrace  ActionKind = "create_trace"   // Create a trace between items
	ActionRespondQuery ActionKind = "respond_query"  // Respond to a query from another node

	// Always autonomous (both modes)
	// Low-risk or purely informational actions.
	ActionPropagateSignal ActionKind = "propagate_signal"  // Propagate change signals through trace graph
	ActionCastAIVote      ActionKind = "cast_ai_vote"      // Cast an AI advisory vote (doesn't count toward quorum)
	ActionAskNetwork      ActionKind = "ask_network"       // Ask a question to another node
)

// governanceActions always require human confirmation regardless of mode.
var governanceActions = map[ActionKind]bool{
	ActionFileChallenge:    true,
	ActionVoteHuman:        true,
	ActionRespondChallenge: true,
	ActionAcceptMembership: true,
}

// alwaysAutonomousActions never require human confirmation in either mode.
var alwaysAutonomousActions = map[ActionKind]bool{
	ActionPropagateSignal: true,
	ActionCastAIVote:      true,
	ActionAskNetwork:      true,
}

// RequiresHumanConfirmation returns true if the given action in the given mode
// requires human confirmation before execution.
func RequiresHumanConfirmation(mode PermissionMode, action ActionKind) bool {
	if governanceActions[action] {
		return true
	}
	if alwaysAutonomousActions[action] {
		return false
	}
	return mode == PermissionNormal
}
```

**Step 4: Run test — expect pass**

Run: `go test -run TestPermissionModeSuite -v ./...`
Expected: All 2 tests pass.

**Step 5: Add `inv config` CLI command**

`PermissionMode` already exists in `config.go` from P2P implementation. The `--mode` flag on `inv serve` and `inv init` also already exists. This step adds `inv config set/get` for runtime config changes.

Add a `configCmd` function to `main.go`:

```go
func configCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "config",
		Short: "Manage node configuration",
	}

	setCmd := &cobra.Command{
		Use:   "set [key] [value]",
		Short: "Set a configuration value (persisted to ~/.inv/config.yaml)",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			key := args[0]
			value := args[1]

			cfgPath := filepath.Join(InvDirPath(), "config.yaml")
			cfg, err := LoadNodeConfig(cfgPath)
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}

			switch key {
			case "permission_mode":
				mode := PermissionMode(value)
				if !IsValidPermissionMode(mode) {
					return fmt.Errorf("invalid permission mode: %s (must be 'normal' or 'autonomous')", value)
				}
				cfg.Node.PermissionMode = mode
			default:
				return fmt.Errorf("unknown config key: %s (available: permission_mode)", key)
			}

			if err := WriteNodeConfig(cfgPath, cfg); err != nil {
				return fmt.Errorf("write config: %w", err)
			}
			fmt.Printf("%s set to: %s\n", key, value)
			return nil
		},
	}

	getCmd := &cobra.Command{
		Use:   "get [key]",
		Short: "Get a configuration value",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			key := args[0]

			cfgPath := filepath.Join(InvDirPath(), "config.yaml")
			cfg, err := LoadNodeConfig(cfgPath)
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}

			switch key {
			case "permission_mode":
				fmt.Println(cfg.Node.PermissionMode)
			default:
				return fmt.Errorf("unknown config key: %s (available: permission_mode)", key)
			}
			return nil
		},
	}

	cmd.AddCommand(setCmd, getCmd)
	return cmd
}
```

Register in `root.AddCommand(...)`: add `configCmd()`.

**Step 6: Verify compilation**

Run: `go build ./...`
Expected: No errors.

**Step 7: Commit**

```bash
git add permission.go events_test.go main.go
git commit -m "feat: add permission matrix (normal/autonomous) with action-level human confirmation rules"
```

---

## Task 8: `inv_config_mode` MCP Tool

**Files:**
- Modify: `mcp_server.go` (add `inv_config_mode` tool)

**Step 1: Write failing test**

Append to `events_test.go`:

```go
type ConfigModeSuite struct {
	suite.Suite
}

func TestConfigModeSuite(t *testing.T) {
	suite.Run(t, new(ConfigModeSuite))
}

func (s *ConfigModeSuite) TestConfigModeResponse() {
	// Test the response type serializes correctly
	resp := ConfigModeResponse{
		CurrentMode:       PermissionAutonomous,
		AvailableModes:    []PermissionMode{PermissionNormal, PermissionAutonomous},
		RequiresHumanFor:  []string{"file_challenge", "vote_human", "respond_challenge", "accept_membership"},
		AutonomousActions: []string{"add_item", "verify_item", "mark_broken", "create_trace", "respond_query"},
		AlwaysAutonomous:  []string{"propagate_signal", "cast_ai_vote", "ask_network"},
	}

	data, err := json.Marshal(resp)
	s.NoError(err)

	var decoded ConfigModeResponse
	err = json.Unmarshal(data, &decoded)
	s.NoError(err)
	s.Equal(PermissionAutonomous, decoded.CurrentMode)
	s.Len(decoded.AvailableModes, 2)
	s.Len(decoded.RequiresHumanFor, 4)
}
```

**Step 2: Run test — expect compilation failure**

Run: `go test -run TestConfigModeSuite -v ./...`
Expected: Compilation error — `ConfigModeResponse` undefined.

**Step 3: Add ConfigModeResponse type**

Append to `permission.go`:

```go
// ConfigModeResponse is returned by the inv_config_mode MCP tool.
type ConfigModeResponse struct {
	CurrentMode       PermissionMode   `json:"current_mode"`
	AvailableModes    []PermissionMode `json:"available_modes"`
	RequiresHumanFor  []string         `json:"requires_human_for"`
	AutonomousActions []string         `json:"autonomous_actions"`
	AlwaysAutonomous  []string         `json:"always_autonomous"`
}

// BuildConfigModeResponse creates the response for the current permission mode.
func BuildConfigModeResponse(mode PermissionMode) ConfigModeResponse {
	resp := ConfigModeResponse{
		CurrentMode:    mode,
		AvailableModes: []PermissionMode{PermissionNormal, PermissionAutonomous},
	}

	allActions := []ActionKind{
		ActionFileChallenge, ActionVoteHuman, ActionRespondChallenge, ActionAcceptMembership,
		ActionAddItem, ActionVerifyItem, ActionMarkBroken, ActionCreateTrace, ActionRespondQuery,
		ActionPropagateSignal, ActionCastAIVote, ActionAskNetwork,
	}

	for _, action := range allActions {
		if governanceActions[action] {
			resp.RequiresHumanFor = append(resp.RequiresHumanFor, string(action))
		} else if alwaysAutonomousActions[action] {
			resp.AlwaysAutonomous = append(resp.AlwaysAutonomous, string(action))
		} else if mode == PermissionAutonomous {
			resp.AutonomousActions = append(resp.AutonomousActions, string(action))
		} else {
			resp.RequiresHumanFor = append(resp.RequiresHumanFor, string(action))
		}
	}

	return resp
}
```

**Step 4: Run test — expect pass**

Run: `go test -run TestConfigModeSuite -v ./...`
Expected: All 1 test pass.

**Step 5: Add MCP tool**

In `mcp_server.go`, add before `return server.ServeStdio(s)`:

```go
s.AddTool(mcp.NewTool("inv_config_mode",
	mcp.WithDescription("Get or set the permission mode. Mode controls which actions AI can take autonomously vs. requiring human confirmation."),
	mcp.WithString("mode", mcp.Description("Set permission mode: 'normal' or 'autonomous'. Omit to get current mode.")),
), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if newMode, ok := req.GetArguments()["mode"].(string); ok && newMode != "" {
		mode := PermissionMode(newMode)
		if !IsValidPermissionMode(mode) {
			return mcp.NewToolResultError(fmt.Sprintf("invalid mode: %s (must be 'normal' or 'autonomous')", newMode)), nil
		}
		cfgPath := filepath.Join(InvDirPath(), "config.yaml")
		cfg, err := LoadNodeConfig(cfgPath)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("load config: %v", err)), nil
		}
		cfg.Node.PermissionMode = mode
		if err := WriteNodeConfig(cfgPath, cfg); err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("set config: %v", err)), nil
		}
		resp := BuildConfigModeResponse(mode)
		return resultJSON(resp)
	}

	cfgPath2 := filepath.Join(InvDirPath(), "config.yaml")
	cfg, err := LoadNodeConfig(cfgPath2)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("load config: %v", err)), nil
	}
	mode := cfg.Node.PermissionMode
	if mode == "" {
		mode = PermissionNormal
	}
	resp := BuildConfigModeResponse(mode)
	return resultJSON(resp)
})
```

**Step 6: Verify compilation**

Run: `go build ./...`
Expected: No errors.

**Step 7: Commit**

```bash
git add permission.go mcp_server.go events_test.go
git commit -m "feat: add inv_config_mode MCP tool for permission mode get/set"
```

---

## Task 9: Multi-Node Audit — `inv audit --all-nodes`

**Files:**
- Modify: `engine.go` (add `AuditAllNodes` method)
- Modify: `main.go` (add `--all-nodes` flag to audit command)
- Modify: `mcp_server.go` (add `inv_audit_all` MCP tool)

**Step 1: Write failing test**

Append to `events_test.go`:

```go
type MultiNodeAuditSuite struct {
	suite.Suite
	store  *Store
	engine *Engine
}

func TestMultiNodeAuditSuite(t *testing.T) {
	suite.Run(t, new(MultiNodeAuditSuite))
}

func (s *MultiNodeAuditSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store

	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	s.engine = NewEngine(store, prop, crsm)
}

func (s *MultiNodeAuditSuite) TearDownTest() {
	s.store.Close()
}

func (s *MultiNodeAuditSuite) TestAuditAllNodesEmpty() {
	ctx := context.Background()

	node, err := s.engine.RegisterNode(ctx, "dev-inv", VerticalDev, "clinic-checkin", "cuong", false)
	s.Require().NoError(err)
	_ = node

	reports, err := s.engine.AuditAllNodes(ctx, "clinic-checkin")
	s.NoError(err)
	s.Len(reports, 1)
	s.Equal(0, reports[0].TotalItems)
}

func (s *MultiNodeAuditSuite) TestAuditAllNodesMultipleNodes() {
	ctx := context.Background()

	devNode, err := s.engine.RegisterNode(ctx, "dev-inv", VerticalDev, "clinic-checkin", "cuong", false)
	s.Require().NoError(err)

	pmNode, err := s.engine.RegisterNode(ctx, "pm-inv", VerticalPM, "clinic-checkin", "duke", false)
	s.Require().NoError(err)

	qaNode, err := s.engine.RegisterNode(ctx, "qa-inv", VerticalQA, "clinic-checkin", "blue", false)
	s.Require().NoError(err)

	// Add items to different nodes
	_, err = s.engine.AddItem(ctx, devNode.ID, KindADR, "Auth design", "", "")
	s.Require().NoError(err)
	_, err = s.engine.AddItem(ctx, devNode.ID, KindAPISpec, "Auth API", "", "")
	s.Require().NoError(err)

	_, err = s.engine.AddItem(ctx, pmNode.ID, KindEpic, "Kiosk check-in", "", "")
	s.Require().NoError(err)

	_, err = s.engine.AddItem(ctx, qaNode.ID, KindTestCase, "E2E test", "", "")
	s.Require().NoError(err)

	reports, err := s.engine.AuditAllNodes(ctx, "clinic-checkin")
	s.NoError(err)
	s.Len(reports, 3)

	// Find dev node report
	var devReport *AuditReport
	for i, r := range reports {
		if r.NodeID == devNode.ID {
			devReport = &reports[i]
			break
		}
	}
	s.NotNil(devReport)
	s.Equal(2, devReport.TotalItems)
}

func (s *MultiNodeAuditSuite) TestAuditAllNodesJSON() {
	ctx := context.Background()

	_, err := s.engine.RegisterNode(ctx, "dev-inv", VerticalDev, "clinic-checkin", "cuong", false)
	s.Require().NoError(err)

	reports, err := s.engine.AuditAllNodes(ctx, "clinic-checkin")
	s.NoError(err)

	data, err := json.Marshal(reports)
	s.NoError(err)

	var decoded []AuditReport
	err = json.Unmarshal(data, &decoded)
	s.NoError(err)
	s.Len(decoded, 1)
}
```

**Step 2: Run test — expect compilation failure**

Run: `go test -run TestMultiNodeAuditSuite -v ./...`
Expected: Compilation error — `AuditAllNodes` undefined on Engine.

**Step 3: Add Engine.AuditAllNodes method**

Append to `engine.go`:

```go
// AuditAllNodes returns audit reports for every node in the given project.
// Used for oversight: review all AI agent activity in one call.
func (e *Engine) AuditAllNodes(ctx context.Context, project string) ([]AuditReport, error) {
	nodes, err := e.store.ListNodes(ctx, project)
	if err != nil {
		return nil, fmt.Errorf("list nodes: %w", err)
	}

	reports := make([]AuditReport, 0, len(nodes))
	for _, node := range nodes {
		report, err := e.store.AuditNode(ctx, node.ID)
		if err != nil {
			return nil, fmt.Errorf("audit node %s: %w", node.ID, err)
		}
		reports = append(reports, *report)
	}
	return reports, nil
}
```

**Step 4: Run test — expect pass**

Run: `go test -run TestMultiNodeAuditSuite -v ./...`
Expected: All 3 tests pass.

**Step 5: Add `--all-nodes` flag to audit CLI**

In `main.go:304-325`, replace the `auditCmd` function:

```go
func auditCmd(e *Engine) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "audit [node-id]",
		Short: "Audit inventory health (single node or all nodes)",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			allNodes, _ := cmd.Flags().GetBool("all-nodes")
			project, _ := cmd.Flags().GetString("project")

			if allNodes {
				reports, err := e.AuditAllNodes(context.Background(), project)
				if err != nil {
					return err
				}
				data, err := json.MarshalIndent(reports, "", "  ")
				if err != nil {
					return err
				}
				fmt.Println(string(data))
				return nil
			}

			if len(args) == 0 {
				return fmt.Errorf("provide a node-id or use --all-nodes")
			}

			report, err := e.Audit(context.Background(), args[0])
			if err != nil {
				return err
			}

			fmt.Printf("Audit Report for node %s\n", args[0][:8])
			fmt.Printf("  Total items:  %d\n", report.TotalItems)
			fmt.Printf("  Proven:       %d\n", len(report.Proven))
			fmt.Printf("  Unverified:   %d\n", len(report.Unverified))
			fmt.Printf("  Suspect:      %d\n", len(report.Suspect))
			fmt.Printf("  Broke:        %d\n", len(report.Broke))
			fmt.Printf("  Orphans:      %d (no traces)\n", len(report.Orphans))
			return nil
		},
	}
	cmd.Flags().Bool("all-nodes", false, "Audit all nodes in the project")
	cmd.Flags().String("project", "clinic-checkin", "Project name (used with --all-nodes)")
	return cmd
}
```

**Step 6: Add MCP tool**

In `mcp_server.go`, add before `return server.ServeStdio(s)`:

```go
s.AddTool(mcp.NewTool("inv_audit_all",
	mcp.WithDescription("Audit all nodes in the project. Returns audit reports for every node — useful for batch oversight of AI agents."),
	mcp.WithString("project", mcp.Required(), mcp.Description("Project name")),
), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	project, _ := req.RequireString("project")

	reports, err := engine.AuditAllNodes(ctx, project)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return resultJSON(reports)
})
```

**Step 7: Verify compilation**

Run: `go build ./...`
Expected: No errors.

**Step 8: Commit**

```bash
git add engine.go main.go mcp_server.go events_test.go
git commit -m "feat: add multi-node audit for project-wide oversight"
```

---

## Task 10: Item Kind Mapping — File Pattern Detection

**Files:**
- Create: `kind_mapping.go`

**Step 1: Write failing test**

Create `kind_mapping_test.go`:

```go
package main

import (
	"testing"

	"github.com/stretchr/testify/suite"
)

type KindMappingSuite struct {
	suite.Suite
}

func TestKindMappingSuite(t *testing.T) {
	suite.Run(t, new(KindMappingSuite))
}

func (s *KindMappingSuite) TestGoTestFiles() {
	s.Equal(KindTestCase, DetectItemKind("auth_handler_test.go"))
	s.Equal(KindTestCase, DetectItemKind("store_test.go"))
	s.Equal(KindTestCase, DetectItemKind("pkg/handlers/user_test.go"))
}

func (s *KindMappingSuite) TestProtoFiles() {
	s.Equal(KindAPISpec, DetectItemKind("proto/inv.proto"))
	s.Equal(KindAPISpec, DetectItemKind("api/service.proto"))
}

func (s *KindMappingSuite) TestDocsPlanFiles() {
	s.Equal(KindDecision, DetectItemKind("docs/plans/2026-03-18-design.md"))
	s.Equal(KindDecision, DetectItemKind("docs/plans/phase2-implementation.md"))
}

func (s *KindMappingSuite) TestDockerfile() {
	s.Equal(KindRunbook, DetectItemKind("Dockerfile"))
	s.Equal(KindRunbook, DetectItemKind("docker-compose.yml"))
	s.Equal(KindRunbook, DetectItemKind("docker-compose.yaml"))
}

func (s *KindMappingSuite) TestMigrationFiles() {
	s.Equal(KindDataModel, DetectItemKind("migrations/001_initial.sql"))
	s.Equal(KindDataModel, DetectItemKind("db/migrate/002_add_users.sql"))
}

func (s *KindMappingSuite) TestGoHandlerFiles() {
	s.Equal(KindAPISpec, DetectItemKind("auth_handler.go"))
	s.Equal(KindAPISpec, DetectItemKind("handlers/user_handler.go"))
	s.Equal(KindAPISpec, DetectItemKind("api_handler.go"))
}

func (s *KindMappingSuite) TestGoModelFiles() {
	s.Equal(KindDataModel, DetectItemKind("user_model.go"))
	s.Equal(KindDataModel, DetectItemKind("models/patient.go"))
}

func (s *KindMappingSuite) TestDefaultsToCustom() {
	s.Equal(KindCustom, DetectItemKind("main.go"))
	s.Equal(KindCustom, DetectItemKind("README.md"))
	s.Equal(KindCustom, DetectItemKind("package.json"))
}

func (s *KindMappingSuite) TestListKindMappings() {
	mappings := ListKindMappings()
	s.NotEmpty(mappings)

	// Verify structure
	for _, m := range mappings {
		s.NotEmpty(m.Pattern)
		s.NotEmpty(m.Kind)
		s.NotEmpty(m.Description)
	}
}
```

**Step 2: Run test — expect compilation failure**

Run: `go test -run TestKindMappingSuite -v ./...`
Expected: Compilation error — `DetectItemKind`, `ListKindMappings` undefined.

**Step 3: Implement kind mapping**

Create `kind_mapping.go`:

```go
package main

import (
	"path/filepath"
	"strings"
)

// KindMappingRule maps a file pattern to an item kind.
type KindMappingRule struct {
	Pattern     string   `json:"pattern"`
	Kind        ItemKind `json:"kind"`
	Description string   `json:"description"`
}

// kindMappingRules defines the ordered list of file pattern -> item kind rules.
// Rules are checked in order; first match wins.
var kindMappingRules = []KindMappingRule{
	{Pattern: "*_test.go", Kind: KindTestCase, Description: "Go test files"},
	{Pattern: "*.proto", Kind: KindAPISpec, Description: "Protocol buffer definitions"},
	{Pattern: "docs/plans/*.md", Kind: KindDecision, Description: "Architecture decision records and plans"},
	{Pattern: "Dockerfile", Kind: KindRunbook, Description: "Docker build configuration"},
	{Pattern: "docker-compose.yml", Kind: KindRunbook, Description: "Docker Compose configuration"},
	{Pattern: "docker-compose.yaml", Kind: KindRunbook, Description: "Docker Compose configuration"},
	{Pattern: "*.sql", Kind: KindDataModel, Description: "SQL migration files"},
	{Pattern: "*_handler.go", Kind: KindAPISpec, Description: "Go HTTP/API handler files"},
	{Pattern: "*_model.go", Kind: KindDataModel, Description: "Go data model files"},
}

// DetectItemKind determines the item kind for a given file path.
// Returns KindCustom if no rule matches.
func DetectItemKind(filePath string) ItemKind {
	base := filepath.Base(filePath)

	for _, rule := range kindMappingRules {
		// Check if the pattern contains a directory separator
		if strings.Contains(rule.Pattern, "/") {
			// Match against the full path (normalized)
			normalized := filepath.ToSlash(filePath)
			if matched, _ := filepath.Match(rule.Pattern, normalized); matched {
				return rule.Kind
			}
			// Also try matching just the last N path segments
			parts := strings.Split(normalized, "/")
			patternParts := strings.Split(rule.Pattern, "/")
			if len(parts) >= len(patternParts) {
				suffix := strings.Join(parts[len(parts)-len(patternParts):], "/")
				if matched, _ := filepath.Match(rule.Pattern, suffix); matched {
					return rule.Kind
				}
			}
		} else {
			// Match against the base filename only
			if matched, _ := filepath.Match(rule.Pattern, base); matched {
				return rule.Kind
			}
		}
	}

	// Check if the path contains "models/" directory
	if strings.Contains(filepath.ToSlash(filePath), "models/") && strings.HasSuffix(base, ".go") {
		return KindDataModel
	}

	// Check if the path contains "handlers/" directory
	if strings.Contains(filepath.ToSlash(filePath), "handlers/") && strings.HasSuffix(base, ".go") {
		return KindAPISpec
	}

	return KindCustom
}

// ListKindMappings returns all configured kind mapping rules.
func ListKindMappings() []KindMappingRule {
	result := make([]KindMappingRule, len(kindMappingRules))
	copy(result, kindMappingRules)
	return result
}
```

**Step 4: Run test — expect pass**

Run: `go test -run TestKindMappingSuite -v ./...`
Expected: All 9 tests pass.

**Step 5: Commit**

```bash
git add kind_mapping.go kind_mapping_test.go
git commit -m "feat: add file pattern to item kind mapping for Claude Code auto-detection"
```

---

## Task 11: CLAUDE.md Template

**Files:**
- Create: `docs/claude-md-template.md`

**Step 1: Create the template**

```markdown
## Inventory Network

MCP server `inventory` is configured. Project: {{PROJECT_NAME}}.

### Your node
- Node: {{NODE_NAME}} (vertical: {{VERTICAL}}, owner: {{OWNER}})
- Node ID: {{NODE_ID}}
- Mode: {{PERMISSION_MODE}}

### Session start
Check inventory status at session start:
1. Call `inv_session_status` with project "{{PROJECT_NAME}}" and node_id "{{NODE_ID}}"
2. Call `inv_pending_events` to catch up on missed events
3. Summarize: suspect items, broken items, pending CRs, unanswered queries, pending events

### During development
When you detect file changes, suggest inventory actions based on context:
- New source file created -> suggest `inv_add_item` (detect kind from file pattern)
- Tests pass -> suggest `inv_verify` for related items with test evidence
- Reading upstream docs -> suggest `inv_add_trace` to upstream items
- Bug fix -> suggest `inv_mark_broken` then fix then `inv_verify`
- New dependency -> suggest `inv_add_trace` with `traced_from` relation

### File pattern -> Item kind
- `*_test.go` -> test-case
- `*.proto` -> api-spec
- `docs/plans/*.md` -> decision (ADR)
- `*_handler.go` -> api-spec
- `*_model.go` -> data-model
- `*.sql` -> data-model
- `Dockerfile` -> runbook

### Governance (ALWAYS requires human confirmation)
- Challenges received -> show to human, require response
- Vote requests -> show to human, require vote decision
- Membership requests -> show to human, require approval/rejection

### In autonomous mode
These actions can be taken without human confirmation:
- Add items to own node
- Create traces
- Verify items with evidence
- Respond to queries from other nodes
- Mark items as broken

### In normal mode
ALL actions require human confirmation before execution.

### Always autonomous (both modes)
- Propagate signals through trace graph
- Cast AI advisory votes (is_ai: true)
- Ask questions to the network

### End of session
When the user says they're done:
1. Call `inv_audit` for your node
2. Call `inv_audit_all` for project-wide overview
3. Summarize: items verified today, suspect items, pending governance
4. Suggest any pending actions before closing
```

**Step 2: Verify file created**

Run: `cat docs/claude-md-template.md | head -5`
Expected: Template content visible.

**Step 3: Commit**

```bash
git add docs/claude-md-template.md
git commit -m "docs: add CLAUDE.md template for inventory network integration"
```

---

## Task 12: Claude Code Hooks Documentation

**Files:**
- Create: `docs/claude-code-hooks.json`

**Step 1: Create hooks configuration**

Create `docs/claude-code-hooks.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "echo 'INV_HINT: File changed, check if inventory item needs update'"
      }
    ],
    "Stop": [
      {
        "command": "echo 'INV_HINT: Session ending. Run inv_audit before closing.'"
      }
    ]
  }
}
```

**Step 2: Verify file created**

Run: `cat docs/claude-code-hooks.json`
Expected: Valid JSON.

**Step 3: Commit**

```bash
git add docs/claude-code-hooks.json
git commit -m "docs: add Claude Code hooks config for inventory hints"
```

---

## Task 13: Comprehensive Workflow Tests

**Files:**
- Create: `workflow_test.go`

**Step 1: Write workflow scenario tests**

Create `workflow_test.go`:

```go
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
	s.dispatcher = NewEventDispatcher(store, nil, logger)
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
	newDispatcher := NewEventDispatcher(s.store, nil, logger)
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
		"auth_handler.go":                        KindAPISpec,
		"auth_handler_test.go":                   KindTestCase,
		"proto/auth.proto":                       KindAPISpec,
		"docs/plans/2026-03-18-auth-design.md":   KindDecision,
		"user_model.go":                          KindDataModel,
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
```

**Step 2: Run test — expect pass**

Run: `go test -run TestWorkflowSuite -v ./...`
Expected: All 8 tests pass.

**Step 3: Run all tests**

Run: `go test -v ./...`
Expected: All tests across all test files pass.

**Step 4: Commit**

```bash
git add workflow_test.go
git commit -m "test: add comprehensive workflow scenario tests for Claude Code integration"
```

---

## Task 14: Final Integration — Wire Everything Together

**Files:**
- Modify: `main.go` (add `serveCmd` with combined P2P + MCP, wire EventDispatcher)
- Modify: `graph.go` (finalize DI wiring)

**Step 1: Add serve command with combined P2P + MCP**

In `main.go`, add the `serveCmd` function that starts both P2P and MCP in a single process:

```go
func serveCmd(scope *pumped.Scope) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "serve",
		Short: "Start combined P2P + MCP server (full network mode)",
		RunE: func(cmd *cobra.Command, args []string) error {
			port, _ := cmd.Flags().GetInt("port")
			mode, _ := cmd.Flags().GetString("mode")

			// Validate permission mode
			permMode := PermissionMode(mode)
			if !IsValidPermissionMode(permMode) {
				return fmt.Errorf("invalid mode: %s (must be 'normal' or 'autonomous')", mode)
			}

			engine, err := pumped.Resolve(scope, NetworkEngine)
			if err != nil {
				return fmt.Errorf("resolve engine: %w", err)
			}

			store, err := pumped.Resolve(scope, DBStore)
			if err != nil {
				return fmt.Errorf("resolve store: %w", err)
			}

			// Prune old events on startup
			pruned, err := store.PruneOldEvents(context.Background(), 7)
			if err != nil {
				fmt.Fprintf(os.Stderr, "warning: failed to prune old events: %v\n", err)
			} else if pruned > 0 {
				fmt.Fprintf(os.Stderr, "pruned %d events older than 7 days\n", pruned)
			}

			_ = engine
			_ = port
			_ = permMode
			// TODO: Start P2P host, create MCP server, wire EventDispatcher with
			// the MCP server instance, start serving on stdio
			// This will be fully connected after P2P implementation

			return fmt.Errorf("serve command not yet fully wired (requires P2P implementation)")
		},
	}
	cmd.Flags().Int("port", 9090, "P2P listen port")
	cmd.Flags().String("mode", "normal", "Permission mode: normal or autonomous")
	return cmd
}
```

Register in `root.AddCommand(...)`: add `serveCmd(scope)`.

**Step 2: Verify compilation**

Run: `go build ./...`
Expected: No errors.

**Step 3: Run full test suite**

Run: `go test -v ./...`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add main.go graph.go
git commit -m "feat: add serve command skeleton and finalize DI wiring for workflow integration"
```

---

## Summary

| Task | Files | Tests | Description |
|------|-------|-------|-------------|
| 1 | `events.go`, `events_test.go` | 4 | Event types: `EventKind`, `NodeEvent`, typed payloads |
| 2 | `store.go`, `events.go`, `events_test.go` | 5 | Events SQLite table + CRUD |
| 3 | `event_dispatcher.go`, `event_dispatcher_test.go`, `graph.go` | 4 | EventDispatcher: persist + MCP notify |
| 4 | `p2p_handlers.go`, `event_dispatcher_test.go` | 6 | P2P handlers emit events |
| 5 | `engine.go`, `mcp_server.go`, `events_test.go` | 2 | `inv_pending_events` MCP tool |
| 6 | `engine.go`, `store.go`, `mcp_server.go`, `events_test.go` | 3 | `inv_session_status` MCP tool |
| 7 | `permission.go`, `config.go`, `main.go`, `events_test.go` | 3 | Permission mode (normal/autonomous) |
| 8 | `permission.go`, `mcp_server.go`, `events_test.go` | 1 | `inv_config_mode` MCP tool |
| 9 | `engine.go`, `main.go`, `mcp_server.go`, `events_test.go` | 3 | Multi-node audit |
| 10 | `kind_mapping.go`, `kind_mapping_test.go` | 9 | File pattern -> item kind |
| 11 | `docs/claude-md-template.md` | 0 | CLAUDE.md template |
| 12 | `docs/claude-code-hooks.json` | 0 | Claude Code hooks config |
| 13 | `workflow_test.go` | 8 | Comprehensive workflow tests |
| 14 | `main.go`, `graph.go` | 0 | Final wiring |

**Total:** 14 tasks, 48 tests, 14 commits

**New files:** `events.go`, `event_dispatcher.go`, `permission.go`, `kind_mapping.go`, `workflow_test.go`, `events_test.go`, `event_dispatcher_test.go`, `kind_mapping_test.go`, `docs/claude-md-template.md`, `docs/claude-code-hooks.json`

**Modified files:** `store.go`, `engine.go`, `mcp_server.go`, `main.go`, `graph.go`, `config.go`, `p2p_handlers.go`

**New MCP tools:** `inv_pending_events`, `inv_session_status`, `inv_config_mode`, `inv_audit_all`

**Deferred to post-MVP:** `inv_suggest`, `inv_batch_confirm` (suggestion queue + batch confirmation)
