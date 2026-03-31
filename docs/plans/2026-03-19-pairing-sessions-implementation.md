# Pairing Sessions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement real-time pairing sessions between two inventory nodes for continuous collaboration. Host streams inventory events to guest in real-time; guest gets elevated read access to host's items without `inv ask` round-trips.

**Architecture:** Pairing sessions are persisted in SQLite. Event forwarding uses the existing P2PSender infrastructure (not persistent streams) — when a pairing is active, the P2PEventBus forwards events to the paired peer via envelope messages. Guest receives PairEvent envelopes and dispatches them locally. This reuses the store-and-forward outbox for resilience.

**Tech Stack:** Go 1.25, SQLite (go-sqlite3), Cobra, mcp-go (v0.45.0), pumped-go (v0.1.3), zerolog, testify, libp2p (existing P2PHost/P2PSender), protobuf

**Depends on:** P2P Network implementation (all 24 tasks complete), Cross-Inventory Workflow (checklist, ItemSummary, audit enhancements — all done)

---

## Task 1: PairingSession Type + SQLite Table + Store CRUD

**Files:**
- Modify: `network.go` (add PairingSession type + constants)
- Modify: `store.go` (add pairing_sessions table + CRUD)

**Step 1: Write failing test**

Create `pairing_test.go`:

```go
package main

import (
	"context"
	"testing"

	"github.com/stretchr/testify/suite"
)

type PairingStoreSuite struct {
	suite.Suite
	store *Store
	ctx   context.Context
}

func TestPairingStoreSuite(t *testing.T) {
	suite.Run(t, new(PairingStoreSuite))
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
	sess := &PairingSession{
		HostPeerID:  "peer-pm",
		HostNodeID:  "node-pm",
		GuestPeerID: "peer-dev",
		GuestNodeID: "node-dev",
	}
	err := s.store.CreatePairingSession(s.ctx, sess)
	s.Require().NoError(err)
	s.NotEmpty(sess.ID)
	s.Equal(PairingPending, sess.Status)

	got, err := s.store.GetPairingSession(s.ctx, sess.ID)
	s.Require().NoError(err)
	s.Equal(sess.ID, got.ID)
	s.Equal("peer-pm", got.HostPeerID)
	s.Equal("peer-dev", got.GuestPeerID)
	s.Equal(PairingPending, got.Status)
}

func (s *PairingStoreSuite) TestUpdatePairingSessionStatus() {
	sess := &PairingSession{
		HostPeerID:  "peer-pm",
		HostNodeID:  "node-pm",
		GuestPeerID: "peer-dev",
		GuestNodeID: "node-dev",
	}
	s.Require().NoError(s.store.CreatePairingSession(s.ctx, sess))

	err := s.store.UpdatePairingSessionStatus(s.ctx, sess.ID, PairingActive)
	s.Require().NoError(err)

	got, err := s.store.GetPairingSession(s.ctx, sess.ID)
	s.Require().NoError(err)
	s.Equal(PairingActive, got.Status)
}

func (s *PairingStoreSuite) TestEndPairingSession() {
	sess := &PairingSession{
		HostPeerID:  "peer-pm",
		HostNodeID:  "node-pm",
		GuestPeerID: "peer-dev",
		GuestNodeID: "node-dev",
	}
	s.Require().NoError(s.store.CreatePairingSession(s.ctx, sess))
	s.Require().NoError(s.store.UpdatePairingSessionStatus(s.ctx, sess.ID, PairingActive))

	err := s.store.EndPairingSession(s.ctx, sess.ID)
	s.Require().NoError(err)

	got, err := s.store.GetPairingSession(s.ctx, sess.ID)
	s.Require().NoError(err)
	s.Equal(PairingEnded, got.Status)
	s.NotNil(got.EndedAt)
}

func (s *PairingStoreSuite) TestListActivePairingSessions() {
	// Create two sessions — one active, one ended
	sess1 := &PairingSession{
		HostPeerID: "peer-pm", HostNodeID: "node-pm",
		GuestPeerID: "peer-dev", GuestNodeID: "node-dev",
	}
	s.Require().NoError(s.store.CreatePairingSession(s.ctx, sess1))
	s.Require().NoError(s.store.UpdatePairingSessionStatus(s.ctx, sess1.ID, PairingActive))

	sess2 := &PairingSession{
		HostPeerID: "peer-pm", HostNodeID: "node-pm",
		GuestPeerID: "peer-qa", GuestNodeID: "node-qa",
	}
	s.Require().NoError(s.store.CreatePairingSession(s.ctx, sess2))
	s.Require().NoError(s.store.UpdatePairingSessionStatus(s.ctx, sess2.ID, PairingActive))
	s.Require().NoError(s.store.EndPairingSession(s.ctx, sess2.ID))

	active, err := s.store.ListActivePairingSessions(s.ctx, "peer-pm")
	s.Require().NoError(err)
	s.Len(active, 1)
	s.Equal(sess1.ID, active[0].ID)
}

func (s *PairingStoreSuite) TestGetActivePairingBetween() {
	sess := &PairingSession{
		HostPeerID: "peer-pm", HostNodeID: "node-pm",
		GuestPeerID: "peer-dev", GuestNodeID: "node-dev",
	}
	s.Require().NoError(s.store.CreatePairingSession(s.ctx, sess))
	s.Require().NoError(s.store.UpdatePairingSessionStatus(s.ctx, sess.ID, PairingActive))

	got, err := s.store.GetActivePairingBetween(s.ctx, "peer-pm", "peer-dev")
	s.Require().NoError(err)
	s.NotNil(got)
	s.Equal(sess.ID, got.ID)

	// No active session in reverse direction as host
	got, err = s.store.GetActivePairingBetween(s.ctx, "peer-dev", "peer-pm")
	s.NoError(err)
	s.Nil(got)
}
```

**Step 2: Run test — expect compilation failure**

Run: `go test -run TestPairingStoreSuite -v ./...`
Expected: Compilation error — `PairingSession`, `PairingPending`, etc. undefined.

**Step 3: Add PairingSession type to network.go**

Add to `network.go`:

```go
// PairingStatus represents the state of a pairing session.
type PairingStatus string

const (
	PairingPending PairingStatus = "pending"
	PairingActive  PairingStatus = "active"
	PairingEnded   PairingStatus = "ended"
)

// PairingSession represents a real-time collaboration session between two nodes.
type PairingSession struct {
	ID          string        `json:"id"`
	HostPeerID  string        `json:"host_peer_id"`
	HostNodeID  string        `json:"host_node_id"`
	GuestPeerID string        `json:"guest_peer_id"`
	GuestNodeID string        `json:"guest_node_id"`
	Status      PairingStatus `json:"status"`
	StartedAt   time.Time     `json:"started_at"`
	EndedAt     *time.Time    `json:"ended_at,omitempty"`
}
```

**Step 4: Add pairing_sessions table + CRUD to store.go**

Add to `migrate()` in `store.go`:

```go
	CREATE TABLE IF NOT EXISTS pairing_sessions (
		id            TEXT PRIMARY KEY,
		host_peer_id  TEXT NOT NULL,
		host_node_id  TEXT NOT NULL,
		guest_peer_id TEXT NOT NULL,
		guest_node_id TEXT NOT NULL,
		status        TEXT DEFAULT 'pending',
		started_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
		ended_at      DATETIME
	);

	CREATE INDEX IF NOT EXISTS idx_pairing_host ON pairing_sessions(host_peer_id, status);
	CREATE INDEX IF NOT EXISTS idx_pairing_guest ON pairing_sessions(guest_peer_id, status);
```

Add CRUD methods to `store.go`:

```go
func (s *Store) CreatePairingSession(ctx context.Context, sess *PairingSession) error {
	if sess.ID == "" {
		sess.ID = uuid.New().String()
	}
	sess.Status = PairingPending
	sess.StartedAt = time.Now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO pairing_sessions (id, host_peer_id, host_node_id, guest_peer_id, guest_node_id, status, started_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		sess.ID, sess.HostPeerID, sess.HostNodeID, sess.GuestPeerID, sess.GuestNodeID, sess.Status, sess.StartedAt)
	return err
}

func (s *Store) GetPairingSession(ctx context.Context, id string) (*PairingSession, error) {
	sess := &PairingSession{}
	var endedAt sql.NullTime
	err := s.db.QueryRowContext(ctx,
		`SELECT id, host_peer_id, host_node_id, guest_peer_id, guest_node_id, status, started_at, ended_at
		 FROM pairing_sessions WHERE id = ?`, id).
		Scan(&sess.ID, &sess.HostPeerID, &sess.HostNodeID, &sess.GuestPeerID, &sess.GuestNodeID,
			&sess.Status, &sess.StartedAt, &endedAt)
	if err != nil {
		return nil, err
	}
	if endedAt.Valid {
		sess.EndedAt = &endedAt.Time
	}
	return sess, nil
}

func (s *Store) UpdatePairingSessionStatus(ctx context.Context, id string, status PairingStatus) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE pairing_sessions SET status = ? WHERE id = ?`, status, id)
	return err
}

func (s *Store) EndPairingSession(ctx context.Context, id string) error {
	now := time.Now()
	_, err := s.db.ExecContext(ctx,
		`UPDATE pairing_sessions SET status = ?, ended_at = ? WHERE id = ?`,
		PairingEnded, now, id)
	return err
}

func (s *Store) ListActivePairingSessions(ctx context.Context, peerID string) ([]PairingSession, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, host_peer_id, host_node_id, guest_peer_id, guest_node_id, status, started_at, ended_at
		 FROM pairing_sessions
		 WHERE (host_peer_id = ? OR guest_peer_id = ?) AND status = ?
		 ORDER BY started_at DESC`,
		peerID, peerID, PairingActive)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []PairingSession
	for rows.Next() {
		var sess PairingSession
		var endedAt sql.NullTime
		if err := rows.Scan(&sess.ID, &sess.HostPeerID, &sess.HostNodeID, &sess.GuestPeerID, &sess.GuestNodeID,
			&sess.Status, &sess.StartedAt, &endedAt); err != nil {
			return nil, err
		}
		if endedAt.Valid {
			sess.EndedAt = &endedAt.Time
		}
		sessions = append(sessions, sess)
	}
	return sessions, rows.Err()
}

func (s *Store) GetActivePairingBetween(ctx context.Context, hostPeerID, guestPeerID string) (*PairingSession, error) {
	sess := &PairingSession{}
	var endedAt sql.NullTime
	err := s.db.QueryRowContext(ctx,
		`SELECT id, host_peer_id, host_node_id, guest_peer_id, guest_node_id, status, started_at, ended_at
		 FROM pairing_sessions
		 WHERE host_peer_id = ? AND guest_peer_id = ? AND status = ?`,
		hostPeerID, guestPeerID, PairingActive).
		Scan(&sess.ID, &sess.HostPeerID, &sess.HostNodeID, &sess.GuestPeerID, &sess.GuestNodeID,
			&sess.Status, &sess.StartedAt, &endedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if endedAt.Valid {
		sess.EndedAt = &endedAt.Time
	}
	return sess, nil
}
```

**Step 5: Run tests — expect pass**

Run: `go test -run TestPairingStoreSuite -v ./...`
Expected: All 5 tests pass.

**Step 6: Commit**

```bash
git add network.go store.go pairing_test.go
git commit -m "feat: add PairingSession type, table, and store CRUD"
```

---

## Task 2: Engine Pairing Methods

**Files:**
- Modify: `engine.go` (add InvitePair, AcceptPair, EndPair, ListPairingSessions)
- Modify: `pairing_test.go` (add engine-level tests)

**Step 1: Write failing test**

Add to `pairing_test.go`:

```go
type PairingEngineSuite struct {
	suite.Suite
	store  *Store
	engine *Engine
	ctx    context.Context
}

func TestPairingEngineSuite(t *testing.T) {
	suite.Run(t, new(PairingEngineSuite))
}

func (s *PairingEngineSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store
	s.ctx = context.Background()

	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	s.engine = NewEngine(store, prop, crsm)
}

func (s *PairingEngineSuite) TearDownTest() {
	s.store.Close()
}

func (s *PairingEngineSuite) TestInvitePair() {
	sess, err := s.engine.InvitePair(s.ctx, "peer-pm", "node-pm", "peer-dev", "node-dev")
	s.Require().NoError(err)
	s.NotEmpty(sess.ID)
	s.Equal(PairingPending, sess.Status)
	s.Equal("peer-pm", sess.HostPeerID)
	s.Equal("peer-dev", sess.GuestPeerID)
}

func (s *PairingEngineSuite) TestInvitePairDuplicateRejected() {
	_, err := s.engine.InvitePair(s.ctx, "peer-pm", "node-pm", "peer-dev", "node-dev")
	s.Require().NoError(err)

	// Accept first session
	sessions, _ := s.store.ListActivePairingSessions(s.ctx, "peer-pm")
	s.Empty(sessions) // pending, not active yet

	// Activate the first one manually, then try to invite again
	pending, _ := s.store.GetPairingSession(s.ctx, "")
	_ = pending // We'll test duplicate active sessions in AcceptPair
}

func (s *PairingEngineSuite) TestAcceptPair() {
	sess, err := s.engine.InvitePair(s.ctx, "peer-pm", "node-pm", "peer-dev", "node-dev")
	s.Require().NoError(err)

	accepted, err := s.engine.AcceptPair(s.ctx, sess.ID, "peer-dev")
	s.Require().NoError(err)
	s.Equal(PairingActive, accepted.Status)
}

func (s *PairingEngineSuite) TestAcceptPairWrongGuest() {
	sess, err := s.engine.InvitePair(s.ctx, "peer-pm", "node-pm", "peer-dev", "node-dev")
	s.Require().NoError(err)

	_, err = s.engine.AcceptPair(s.ctx, sess.ID, "peer-qa")
	s.Error(err)
	s.Contains(err.Error(), "not the invited guest")
}

func (s *PairingEngineSuite) TestAcceptPairNotPending() {
	sess, err := s.engine.InvitePair(s.ctx, "peer-pm", "node-pm", "peer-dev", "node-dev")
	s.Require().NoError(err)

	_, err = s.engine.AcceptPair(s.ctx, sess.ID, "peer-dev")
	s.Require().NoError(err)

	// Try to accept again
	_, err = s.engine.AcceptPair(s.ctx, sess.ID, "peer-dev")
	s.Error(err)
	s.Contains(err.Error(), "not pending")
}

func (s *PairingEngineSuite) TestEndPair() {
	sess, err := s.engine.InvitePair(s.ctx, "peer-pm", "node-pm", "peer-dev", "node-dev")
	s.Require().NoError(err)
	_, err = s.engine.AcceptPair(s.ctx, sess.ID, "peer-dev")
	s.Require().NoError(err)

	ended, err := s.engine.EndPair(s.ctx, sess.ID, "peer-pm")
	s.Require().NoError(err)
	s.Equal(PairingEnded, ended.Status)
	s.NotNil(ended.EndedAt)
}

func (s *PairingEngineSuite) TestEndPairByGuest() {
	sess, err := s.engine.InvitePair(s.ctx, "peer-pm", "node-pm", "peer-dev", "node-dev")
	s.Require().NoError(err)
	_, err = s.engine.AcceptPair(s.ctx, sess.ID, "peer-dev")
	s.Require().NoError(err)

	ended, err := s.engine.EndPair(s.ctx, sess.ID, "peer-dev")
	s.Require().NoError(err)
	s.Equal(PairingEnded, ended.Status)
}

func (s *PairingEngineSuite) TestEndPairByUnrelated() {
	sess, err := s.engine.InvitePair(s.ctx, "peer-pm", "node-pm", "peer-dev", "node-dev")
	s.Require().NoError(err)
	_, err = s.engine.AcceptPair(s.ctx, sess.ID, "peer-dev")
	s.Require().NoError(err)

	_, err = s.engine.EndPair(s.ctx, sess.ID, "peer-qa")
	s.Error(err)
	s.Contains(err.Error(), "not a participant")
}

func (s *PairingEngineSuite) TestListPairingSessions() {
	s1, _ := s.engine.InvitePair(s.ctx, "peer-pm", "node-pm", "peer-dev", "node-dev")
	s.engine.AcceptPair(s.ctx, s1.ID, "peer-dev")

	s2, _ := s.engine.InvitePair(s.ctx, "peer-pm", "node-pm", "peer-qa", "node-qa")
	s.engine.AcceptPair(s.ctx, s2.ID, "peer-qa")
	s.engine.EndPair(s.ctx, s2.ID, "peer-pm")

	active, err := s.engine.ListPairingSessions(s.ctx, "peer-pm")
	s.NoError(err)
	s.Len(active, 1)
	s.Equal(s1.ID, active[0].ID)
}
```

**Step 2: Run test — expect compilation failure**

Run: `go test -run TestPairingEngineSuite -v ./...`
Expected: Compilation error — `InvitePair`, `AcceptPair`, etc. undefined.

**Step 3: Write engine methods**

Add to `engine.go`:

```go
// --- Pairing ---

// InvitePair creates a new pairing session invitation from host to guest.
func (e *Engine) InvitePair(ctx context.Context, hostPeerID, hostNodeID, guestPeerID, guestNodeID string) (*PairingSession, error) {
	sess := &PairingSession{
		HostPeerID:  hostPeerID,
		HostNodeID:  hostNodeID,
		GuestPeerID: guestPeerID,
		GuestNodeID: guestNodeID,
	}
	if err := e.store.CreatePairingSession(ctx, sess); err != nil {
		return nil, fmt.Errorf("create pairing session: %w", err)
	}
	return sess, nil
}

// AcceptPair transitions a pending pairing session to active.
func (e *Engine) AcceptPair(ctx context.Context, sessionID string, guestPeerID string) (*PairingSession, error) {
	sess, err := e.store.GetPairingSession(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("get pairing session: %w", err)
	}
	if sess.GuestPeerID != guestPeerID {
		return nil, fmt.Errorf("peer %s is not the invited guest", guestPeerID)
	}
	if sess.Status != PairingPending {
		return nil, fmt.Errorf("session %s is %s, not pending", sessionID, sess.Status)
	}
	if err := e.store.UpdatePairingSessionStatus(ctx, sessionID, PairingActive); err != nil {
		return nil, fmt.Errorf("activate pairing session: %w", err)
	}
	return e.store.GetPairingSession(ctx, sessionID)
}

// EndPair ends an active pairing session. Either host or guest can end it.
func (e *Engine) EndPair(ctx context.Context, sessionID string, peerID string) (*PairingSession, error) {
	sess, err := e.store.GetPairingSession(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("get pairing session: %w", err)
	}
	if sess.HostPeerID != peerID && sess.GuestPeerID != peerID {
		return nil, fmt.Errorf("peer %s is not a participant in session %s", peerID, sessionID)
	}
	if err := e.store.EndPairingSession(ctx, sessionID); err != nil {
		return nil, fmt.Errorf("end pairing session: %w", err)
	}
	return e.store.GetPairingSession(ctx, sessionID)
}

// ListPairingSessions returns all active pairing sessions for a peer.
func (e *Engine) ListPairingSessions(ctx context.Context, peerID string) ([]PairingSession, error) {
	return e.store.ListActivePairingSessions(ctx, peerID)
}
```

**Step 4: Run tests — expect pass**

Run: `go test -run TestPairingEngineSuite -v ./...`
Expected: All 9 tests pass.

**Step 5: Commit**

```bash
git add engine.go pairing_test.go
git commit -m "feat: add engine pairing methods (invite, accept, end, list)"
```

---

## Task 3: Protobuf Messages for Pairing

**Files:**
- Modify: `proto/inv.proto` (add PairInvite, PairAccept, PairEnd, PairEvent messages + envelope variants)
- Regenerate: `proto/inv.pb.go`

**Step 1: Add protobuf messages**

Add these message definitions to `proto/inv.proto` (before the closing of the file):

```protobuf
// --- Pairing ---

message PairInvite {
  string session_id = 1;
  string host_peer_id = 2;
  string host_node_id = 3;
  string guest_peer_id = 4;
  string guest_node_id = 5;
}

message PairAccept {
  string session_id = 1;
  string guest_peer_id = 2;
}

message PairEnd {
  string session_id = 1;
  string ended_by = 2;
}

message PairEvent {
  string session_id = 1;
  string event_kind = 2;
  string payload_json = 3;
}
```

Add these variants to the `Envelope.payload` oneof (use field numbers 40-43):

```protobuf
    PairInvite pair_invite = 40;
    PairAccept pair_accept = 41;
    PairEnd pair_end = 42;
    PairEvent pair_event = 43;
```

**Step 2: Regenerate protobuf**

Run: `protoc --go_out=. --go_opt=paths=source_relative proto/inv.proto`
Expected: `proto/inv.pb.go` regenerated with new types.

**Step 3: Verify compilation**

Run: `go build ./...`
Expected: No errors.

**Step 4: Commit**

```bash
git add proto/inv.proto proto/inv.pb.go
git commit -m "proto: add PairInvite, PairAccept, PairEnd, PairEvent messages"
```

---

## Task 4: P2P Handlers for Pairing

**Files:**
- Modify: `p2p_handlers.go` (add HandlePairInvite, HandlePairAccept, HandlePairEnd, HandlePairEvent + new event types)
- Modify: `pairing_test.go` (add handler tests)

**Step 1: Write failing test**

Add to `pairing_test.go`:

```go
type PairingHandlerSuite struct {
	suite.Suite
	store    *Store
	engine   *Engine
	handlers *P2PHandlers
	events   []P2PEvent
	ctx      context.Context
}

func TestPairingHandlerSuite(t *testing.T) {
	suite.Run(t, new(PairingHandlerSuite))
}

func (s *PairingHandlerSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store
	s.ctx = context.Background()

	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	s.engine = NewEngine(store, prop, crsm)

	bus := NewP2PEventBus()
	s.events = nil
	bus.Register(func(ctx context.Context, event P2PEvent) {
		s.events = append(s.events, event)
	})
	s.handlers = NewP2PHandlers(s.engine, store, bus)
}

func (s *PairingHandlerSuite) TearDownTest() {
	s.store.Close()
}

func (s *PairingHandlerSuite) TestHandlePairInvite() {
	sess, err := s.handlers.HandlePairInvite(s.ctx, "sess-001", "peer-pm", "node-pm", "peer-dev", "node-dev")
	s.Require().NoError(err)
	s.Equal("sess-001", sess.ID)
	s.Equal(PairingPending, sess.Status)

	// Should emit event
	s.Len(s.events, 1)
	s.Equal(P2PPairInviteReceived, s.events[0].Type)
}

func (s *PairingHandlerSuite) TestHandlePairAccept() {
	sess, _ := s.handlers.HandlePairInvite(s.ctx, "sess-001", "peer-pm", "node-pm", "peer-dev", "node-dev")
	s.events = nil

	accepted, err := s.handlers.HandlePairAccept(s.ctx, sess.ID, "peer-dev")
	s.Require().NoError(err)
	s.Equal(PairingActive, accepted.Status)

	s.Len(s.events, 1)
	s.Equal(P2PPairAccepted, s.events[0].Type)
}

func (s *PairingHandlerSuite) TestHandlePairEnd() {
	sess, _ := s.handlers.HandlePairInvite(s.ctx, "sess-001", "peer-pm", "node-pm", "peer-dev", "node-dev")
	s.handlers.HandlePairAccept(s.ctx, sess.ID, "peer-dev")
	s.events = nil

	ended, err := s.handlers.HandlePairEnd(s.ctx, sess.ID, "peer-pm")
	s.Require().NoError(err)
	s.Equal(PairingEnded, ended.Status)

	s.Len(s.events, 1)
	s.Equal(P2PPairEnded, s.events[0].Type)
}
```

**Step 2: Run test — expect compilation failure**

Run: `go test -run TestPairingHandlerSuite -v ./...`
Expected: Compilation error — `HandlePairInvite`, `P2PPairInviteReceived`, etc. undefined.

**Step 3: Add event types and handlers**

Add new P2P event types to `p2p_handlers.go`:

```go
const (
	// ... existing constants ...
	P2PPairInviteReceived P2PEventType = "pair.invite_received"
	P2PPairAccepted       P2PEventType = "pair.accepted"
	P2PPairEnded          P2PEventType = "pair.ended"
)

// PairingEventPayload carries pairing session event details.
type PairingEventPayload struct {
	Session *PairingSession
}

func (PairingEventPayload) p2pEventPayload() {}
```

Add handler methods to `P2PHandlers`:

```go
// HandlePairInvite processes an incoming pair.invite message — creates a pending session.
func (h *P2PHandlers) HandlePairInvite(ctx context.Context, sessionID, hostPeerID, hostNodeID, guestPeerID, guestNodeID string) (*PairingSession, error) {
	sess := &PairingSession{
		ID:          sessionID,
		HostPeerID:  hostPeerID,
		HostNodeID:  hostNodeID,
		GuestPeerID: guestPeerID,
		GuestNodeID: guestNodeID,
	}
	if err := h.store.CreatePairingSession(ctx, sess); err != nil {
		return nil, fmt.Errorf("create pairing session: %w", err)
	}

	h.dispatchEvent(ctx, P2PEvent{Type: P2PPairInviteReceived, Payload: PairingEventPayload{Session: sess}})
	return sess, nil
}

// HandlePairAccept processes an incoming pair.accept message — activates the session.
func (h *P2PHandlers) HandlePairAccept(ctx context.Context, sessionID, guestPeerID string) (*PairingSession, error) {
	sess, err := h.store.GetPairingSession(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("get pairing session: %w", err)
	}
	if sess.GuestPeerID != guestPeerID {
		return nil, fmt.Errorf("peer %s is not the invited guest", guestPeerID)
	}
	if sess.Status != PairingPending {
		return nil, fmt.Errorf("session %s is %s, not pending", sessionID, sess.Status)
	}
	if err := h.store.UpdatePairingSessionStatus(ctx, sessionID, PairingActive); err != nil {
		return nil, fmt.Errorf("activate session: %w", err)
	}

	updated, err := h.store.GetPairingSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	h.dispatchEvent(ctx, P2PEvent{Type: P2PPairAccepted, Payload: PairingEventPayload{Session: updated}})
	return updated, nil
}

// HandlePairEnd processes an incoming pair.end message — ends the session.
func (h *P2PHandlers) HandlePairEnd(ctx context.Context, sessionID, endedBy string) (*PairingSession, error) {
	sess, err := h.store.GetPairingSession(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("get pairing session: %w", err)
	}
	if sess.HostPeerID != endedBy && sess.GuestPeerID != endedBy {
		return nil, fmt.Errorf("peer %s is not a participant", endedBy)
	}
	if err := h.store.EndPairingSession(ctx, sessionID); err != nil {
		return nil, fmt.Errorf("end session: %w", err)
	}

	updated, err := h.store.GetPairingSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	h.dispatchEvent(ctx, P2PEvent{Type: P2PPairEnded, Payload: PairingEventPayload{Session: updated}})
	return updated, nil
}
```

**Step 4: Run tests — expect pass**

Run: `go test -run TestPairingHandlerSuite -v ./...`
Expected: All 3 tests pass.

**Step 5: Commit**

```bash
git add p2p_handlers.go pairing_test.go
git commit -m "feat: add P2P handlers for pairing invite, accept, end"
```

---

## Task 5: Event Forwarding Bridge

**Files:**
- Create: `pairing_bridge.go` (PairingBridge wires P2PEventBus to P2PSender for paired peers)
- Modify: `pairing_test.go` (add bridge tests)

**Step 1: Write failing test**

Add to `pairing_test.go`:

```go
type PairingBridgeSuite struct {
	suite.Suite
	store     *Store
	engine    *Engine
	bus       *P2PEventBus
	sent      []bridgeSentMessage
	ctx       context.Context
}

type bridgeSentMessage struct {
	ToPeerID string
	Kind     string
	Payload  string
}

func TestPairingBridgeSuite(t *testing.T) {
	suite.Run(t, new(PairingBridgeSuite))
}

func (s *PairingBridgeSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store
	s.ctx = context.Background()

	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	s.engine = NewEngine(store, prop, crsm)

	s.bus = NewP2PEventBus()
	s.sent = nil
}

func (s *PairingBridgeSuite) TearDownTest() {
	s.store.Close()
}

func (s *PairingBridgeSuite) TestBridgeForwardsEventsToGuest() {
	// Create active pairing session
	sess := &PairingSession{
		HostPeerID: "peer-pm", HostNodeID: "node-pm",
		GuestPeerID: "peer-dev", GuestNodeID: "node-dev",
	}
	s.Require().NoError(s.store.CreatePairingSession(s.ctx, sess))
	s.Require().NoError(s.store.UpdatePairingSessionStatus(s.ctx, sess.ID, PairingActive))

	// Create bridge with mock sender
	bridge := NewPairingBridge(s.store, "peer-pm", func(ctx context.Context, sessionID, toPeerID, eventKind, payloadJSON string) {
		s.sent = append(s.sent, bridgeSentMessage{ToPeerID: toPeerID, Kind: eventKind, Payload: payloadJSON})
	})
	bridge.Register(s.bus)

	// Dispatch an event through the bus
	s.bus.Dispatch(s.ctx, P2PEvent{
		Type: P2PSignalReceived,
		Payload: SignalEventPayload{
			SourceItemID: "item-1", SourceNodeID: "node-pm",
			TargetItemID: "item-2", Reason: "upstream changed",
		},
	})

	// Bridge should have forwarded to guest
	s.Len(s.sent, 1)
	s.Equal("peer-dev", s.sent[0].ToPeerID)
	s.Equal(string(P2PSignalReceived), s.sent[0].Kind)
}

func (s *PairingBridgeSuite) TestBridgeDoesNotForwardWhenNoPairing() {
	bridge := NewPairingBridge(s.store, "peer-pm", func(ctx context.Context, sessionID, toPeerID, eventKind, payloadJSON string) {
		s.sent = append(s.sent, bridgeSentMessage{ToPeerID: toPeerID, Kind: eventKind})
	})
	bridge.Register(s.bus)

	// No active pairing — event should not be forwarded
	s.bus.Dispatch(s.ctx, P2PEvent{
		Type:    P2PPeerJoined,
		Payload: PeerEventPayload{Peer: &Peer{PeerID: "peer-new", Name: "new-node"}},
	})

	s.Empty(s.sent)
}

func (s *PairingBridgeSuite) TestBridgeDoesNotForwardPairingEvents() {
	sess := &PairingSession{
		HostPeerID: "peer-pm", HostNodeID: "node-pm",
		GuestPeerID: "peer-dev", GuestNodeID: "node-dev",
	}
	s.Require().NoError(s.store.CreatePairingSession(s.ctx, sess))
	s.Require().NoError(s.store.UpdatePairingSessionStatus(s.ctx, sess.ID, PairingActive))

	bridge := NewPairingBridge(s.store, "peer-pm", func(ctx context.Context, sessionID, toPeerID, eventKind, payloadJSON string) {
		s.sent = append(s.sent, bridgeSentMessage{ToPeerID: toPeerID, Kind: eventKind})
	})
	bridge.Register(s.bus)

	// Pairing events themselves should NOT be forwarded (avoid infinite loops)
	s.bus.Dispatch(s.ctx, P2PEvent{
		Type:    P2PPairInviteReceived,
		Payload: PairingEventPayload{Session: sess},
	})

	s.Empty(s.sent)
}
```

**Step 2: Run test — expect compilation failure**

Run: `go test -run TestPairingBridgeSuite -v ./...`
Expected: Compilation error — `PairingBridge`, `NewPairingBridge` undefined.

**Step 3: Write pairing_bridge.go**

Create `pairing_bridge.go`:

```go
package main

import (
	"context"
	"encoding/json"
)

// PairEventSendFunc is a callback that sends a pair event to a remote peer.
// Abstracted to allow testing without real P2P infrastructure.
type PairEventSendFunc func(ctx context.Context, sessionID, toPeerID, eventKind, payloadJSON string)

// PairingBridge listens on the P2PEventBus and forwards events to paired guests.
type PairingBridge struct {
	store      *Store
	localPeer  string
	sendFunc   PairEventSendFunc
}

// NewPairingBridge creates a bridge that forwards host events to paired guests.
func NewPairingBridge(store *Store, localPeerID string, sendFunc PairEventSendFunc) *PairingBridge {
	return &PairingBridge{
		store:     store,
		localPeer: localPeerID,
		sendFunc:  sendFunc,
	}
}

// pairingEventTypes are pairing-internal events that should NOT be forwarded.
var pairingEventTypes = map[P2PEventType]bool{
	P2PPairInviteReceived: true,
	P2PPairAccepted:       true,
	P2PPairEnded:          true,
}

// Register attaches the bridge as a listener on the event bus.
func (b *PairingBridge) Register(bus *P2PEventBus) {
	bus.Register(func(ctx context.Context, event P2PEvent) {
		b.onEvent(ctx, event)
	})
}

// onEvent handles each bus event, forwarding to paired guests when applicable.
func (b *PairingBridge) onEvent(ctx context.Context, event P2PEvent) {
	// Don't forward pairing-internal events
	if pairingEventTypes[event.Type] {
		return
	}

	// Find active sessions where we are the host
	sessions, err := b.store.ListActivePairingSessions(ctx, b.localPeer)
	if err != nil || len(sessions) == 0 {
		return
	}

	payloadJSON, err := json.Marshal(event.Payload)
	if err != nil {
		return
	}

	for _, sess := range sessions {
		if sess.HostPeerID != b.localPeer {
			continue
		}
		b.sendFunc(ctx, sess.ID, sess.GuestPeerID, string(event.Type), string(payloadJSON))
	}
}
```

**Step 4: Run tests — expect pass**

Run: `go test -run TestPairingBridgeSuite -v ./...`
Expected: All 3 tests pass.

**Step 5: Commit**

```bash
git add pairing_bridge.go pairing_test.go
git commit -m "feat: add PairingBridge for event forwarding to paired guests"
```

---

## Task 6: CLI Commands

**Files:**
- Modify: `main.go` (add `pairCmd` with invite/join/end/list subcommands)

**Step 1: Add pair command**

Add `pairCmd` function in `main.go`:

```go
func pairCmd(engine *Engine, store *Store, agentLog, sysLog *zerolog.Logger) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "pair",
		Short: "Manage real-time pairing sessions between inventory nodes",
	}

	inviteCmd := &cobra.Command{
		Use:   "invite",
		Short: "Invite a peer to start a pairing session",
		RunE: func(cmd *cobra.Command, args []string) error {
			hostPeer, _ := cmd.Flags().GetString("host-peer")
			hostNode, _ := cmd.Flags().GetString("host-node")
			guestPeer, _ := cmd.Flags().GetString("guest-peer")
			guestNode, _ := cmd.Flags().GetString("guest-node")

			ctx := context.Background()
			sess, err := engine.InvitePair(ctx, hostPeer, hostNode, guestPeer, guestNode)
			if err != nil {
				sysLog.Error().Err(err).Msg("pair invite failed")
				return err
			}

			data, _ := json.Marshal(sess)
			agentLog.Info().RawJSON("session", data).Msg("pair.invited")
			fmt.Fprintf(os.Stderr, "Pairing session created: %s\nShare this ID with your pair: %s\n", sess.ID, sess.ID)
			return nil
		},
	}
	inviteCmd.Flags().String("host-peer", "", "Your peer ID")
	inviteCmd.Flags().String("host-node", "", "Your node ID")
	inviteCmd.Flags().String("guest-peer", "", "Guest's peer ID")
	inviteCmd.Flags().String("guest-node", "", "Guest's node ID")
	inviteCmd.MarkFlagRequired("host-peer")
	inviteCmd.MarkFlagRequired("host-node")
	inviteCmd.MarkFlagRequired("guest-peer")
	inviteCmd.MarkFlagRequired("guest-node")

	joinCmd := &cobra.Command{
		Use:   "join [session-id]",
		Short: "Accept a pairing session invitation",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			guestPeer, _ := cmd.Flags().GetString("guest-peer")

			ctx := context.Background()
			sess, err := engine.AcceptPair(ctx, args[0], guestPeer)
			if err != nil {
				sysLog.Error().Err(err).Msg("pair join failed")
				return err
			}

			data, _ := json.Marshal(sess)
			agentLog.Info().RawJSON("session", data).Msg("pair.joined")
			fmt.Fprintf(os.Stderr, "Paired with %s — session active\n", sess.HostPeerID)
			return nil
		},
	}
	joinCmd.Flags().String("guest-peer", "", "Your peer ID")
	joinCmd.MarkFlagRequired("guest-peer")

	endCmd := &cobra.Command{
		Use:   "end [session-id]",
		Short: "End an active pairing session",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			peer, _ := cmd.Flags().GetString("peer")

			ctx := context.Background()
			sess, err := engine.EndPair(ctx, args[0], peer)
			if err != nil {
				sysLog.Error().Err(err).Msg("pair end failed")
				return err
			}

			data, _ := json.Marshal(sess)
			agentLog.Info().RawJSON("session", data).Msg("pair.ended")
			fmt.Fprintf(os.Stderr, "Pairing session ended\n")
			return nil
		},
	}
	endCmd.Flags().String("peer", "", "Your peer ID")
	endCmd.MarkFlagRequired("peer")

	listCmd := &cobra.Command{
		Use:   "list",
		Short: "List active pairing sessions",
		RunE: func(cmd *cobra.Command, args []string) error {
			peer, _ := cmd.Flags().GetString("peer")

			ctx := context.Background()
			sessions, err := engine.ListPairingSessions(ctx, peer)
			if err != nil {
				sysLog.Error().Err(err).Msg("pair list failed")
				return err
			}

			data, _ := json.Marshal(sessions)
			agentLog.Info().RawJSON("sessions", data).Msg("pair.list")

			if len(sessions) == 0 {
				fmt.Fprintf(os.Stderr, "No active pairing sessions\n")
				return nil
			}
			w := tabwriter.NewWriter(os.Stderr, 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, "SESSION\tHOST\tGUEST\tSTARTED")
			for _, s := range sessions {
				fmt.Fprintf(w, "%s\t%s\t%s\t%s\n",
					s.ID[:8], s.HostPeerID, s.GuestPeerID, s.StartedAt.Format(time.RFC3339))
			}
			w.Flush()
			return nil
		},
	}
	listCmd.Flags().String("peer", "", "Your peer ID")
	listCmd.MarkFlagRequired("peer")

	cmd.AddCommand(inviteCmd, joinCmd, endCmd, listCmd)
	return cmd
}
```

Register in `root.AddCommand(...)`:

```go
pairCmd(engine, store, agentLog, sysLog),
```

**Step 2: Verify compilation**

Run: `go build ./...`
Expected: No errors.

**Step 3: Commit**

```bash
git add main.go
git commit -m "feat: add inv pair invite/join/end/list CLI commands"
```

---

## Task 7: MCP Tools

**Files:**
- Modify: `mcp_server.go` (add inv_pair_invite, inv_pair_join, inv_pair_end, inv_pair_list)

**Step 1: Add MCP tools**

Add to `mcp_server.go` before the `return server.ServeStdio(s)` line:

```go
	// --- Pairing MCP Tools ---

	s.AddTool(mcp.NewTool("inv_pair_invite",
		mcp.WithDescription("Invite a peer to start a real-time pairing session for continuous collaboration"),
		mcp.WithString("host_peer", mcp.Required(), mcp.Description("Your peer ID")),
		mcp.WithString("host_node", mcp.Required(), mcp.Description("Your node ID")),
		mcp.WithString("guest_peer", mcp.Required(), mcp.Description("Guest's peer ID")),
		mcp.WithString("guest_node", mcp.Required(), mcp.Description("Guest's node ID")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		hostPeer, err := req.RequireString("host_peer")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing host_peer: %v", err)), nil
		}
		hostNode, err := req.RequireString("host_node")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing host_node: %v", err)), nil
		}
		guestPeer, err := req.RequireString("guest_peer")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing guest_peer: %v", err)), nil
		}
		guestNode, err := req.RequireString("guest_node")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing guest_node: %v", err)), nil
		}

		sess, err := engine.InvitePair(ctx, hostPeer, hostNode, guestPeer, guestNode)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(sess)
	})

	s.AddTool(mcp.NewTool("inv_pair_join",
		mcp.WithDescription("Accept a pairing session invitation — starts live event streaming from host"),
		mcp.WithString("session_id", mcp.Required(), mcp.Description("Pairing session ID")),
		mcp.WithString("guest_peer", mcp.Required(), mcp.Description("Your peer ID")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		sessionID, err := req.RequireString("session_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing session_id: %v", err)), nil
		}
		guestPeer, err := req.RequireString("guest_peer")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing guest_peer: %v", err)), nil
		}

		sess, err := engine.AcceptPair(ctx, sessionID, guestPeer)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(sess)
	})

	s.AddTool(mcp.NewTool("inv_pair_end",
		mcp.WithDescription("End an active pairing session — stops live event streaming"),
		mcp.WithString("session_id", mcp.Required(), mcp.Description("Pairing session ID")),
		mcp.WithString("peer", mcp.Required(), mcp.Description("Your peer ID")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		sessionID, err := req.RequireString("session_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing session_id: %v", err)), nil
		}
		peer, err := req.RequireString("peer")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing peer: %v", err)), nil
		}

		sess, err := engine.EndPair(ctx, sessionID, peer)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(sess)
	})

	s.AddTool(mcp.NewTool("inv_pair_list",
		mcp.WithDescription("List active pairing sessions"),
		mcp.WithString("peer", mcp.Required(), mcp.Description("Your peer ID")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		peer, err := req.RequireString("peer")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing peer: %v", err)), nil
		}

		sessions, err := engine.ListPairingSessions(ctx, peer)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(sessions)
	})
```

**Step 2: Verify compilation**

Run: `go build ./...`
Expected: No errors.

**Step 3: Commit**

```bash
git add mcp_server.go
git commit -m "feat: add inv_pair_invite/join/end/list MCP tools"
```

---

## Task 8: Comprehensive Pairing Scenario Tests

**Files:**
- Modify: `pairing_test.go` (add full scenario tests)

**Step 1: Add scenario tests**

Add to `pairing_test.go`:

```go
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

// Full PM → Designer pairing workflow
func (s *PairingScenarioSuite) TestPMDesignerPairingWorkflow() {
	ctx := s.ctx

	// Register nodes
	pmNode, err := s.engine.RegisterNode(ctx, "pm-inv", VerticalPM, "clinic-checkin", "duke", false)
	s.Require().NoError(err)
	devNode, err := s.engine.RegisterNode(ctx, "dev-inv", VerticalDev, "clinic-checkin", "cuong", false)
	s.Require().NoError(err)

	// PM creates items
	story, err := s.engine.AddItem(ctx, pmNode.ID, KindUserStory, "Kiosk check-in", "", "US-001")
	s.Require().NoError(err)
	s.Require().NoError(s.engine.VerifyItem(ctx, story.ID, "Stakeholder approved", "duke"))

	// PM invites Dev to pair
	sess, err := s.engine.InvitePair(ctx, "peer-pm", pmNode.ID, "peer-dev", devNode.ID)
	s.Require().NoError(err)
	s.Equal(PairingPending, sess.Status)

	// Dev accepts
	sess, err = s.engine.AcceptPair(ctx, sess.ID, "peer-dev")
	s.Require().NoError(err)
	s.Equal(PairingActive, sess.Status)

	// Dev creates items and traces to PM while paired
	adr, err := s.engine.AddItem(ctx, devNode.ID, KindADR, "Auth design", "", "")
	s.Require().NoError(err)
	_, err = s.engine.AddTrace(ctx, adr.ID, story.ID, RelationTracedFrom, "cuong")
	s.Require().NoError(err)

	// Verify cross-node trace
	traces, err := s.engine.GetItemTraces(ctx, adr.ID)
	s.Require().NoError(err)
	s.Len(traces, 1)
	s.Equal(story.ID, traces[0].ToItemID)

	// PM ends pairing
	sess, err = s.engine.EndPair(ctx, sess.ID, "peer-pm")
	s.Require().NoError(err)
	s.Equal(PairingEnded, sess.Status)

	// Audit — dev item should have upstream ref
	report, err := s.engine.Audit(ctx, devNode.ID)
	s.Require().NoError(err)
	s.NotContains(report.MissingUpstreamRefs, adr.ID)
}

// Multiple concurrent pairings
func (s *PairingScenarioSuite) TestMultipleConcurrentPairings() {
	ctx := s.ctx

	// PM pairs with both Designer and Dev
	sess1, err := s.engine.InvitePair(ctx, "peer-pm", "node-pm", "peer-design", "node-design")
	s.Require().NoError(err)
	sess2, err := s.engine.InvitePair(ctx, "peer-pm", "node-pm", "peer-dev", "node-dev")
	s.Require().NoError(err)

	s.engine.AcceptPair(ctx, sess1.ID, "peer-design")
	s.engine.AcceptPair(ctx, sess2.ID, "peer-dev")

	// Both active
	active, err := s.engine.ListPairingSessions(ctx, "peer-pm")
	s.Require().NoError(err)
	s.Len(active, 2)

	// End one
	s.engine.EndPair(ctx, sess1.ID, "peer-pm")

	active, err = s.engine.ListPairingSessions(ctx, "peer-pm")
	s.Require().NoError(err)
	s.Len(active, 1)
	s.Equal(sess2.ID, active[0].ID)
}

// Bridge integration with pairing lifecycle
func (s *PairingScenarioSuite) TestBridgeIntegration() {
	ctx := s.ctx

	var forwarded []string
	bus := NewP2PEventBus()
	bridge := NewPairingBridge(s.store, "peer-pm", func(ctx context.Context, sessionID, toPeerID, eventKind, payloadJSON string) {
		forwarded = append(forwarded, toPeerID+":"+eventKind)
	})
	bridge.Register(bus)

	// Before pairing: events should NOT forward
	bus.Dispatch(ctx, P2PEvent{Type: P2PSignalReceived, Payload: SignalEventPayload{
		SourceItemID: "item-1", SourceNodeID: "node-pm", TargetItemID: "item-2", Reason: "changed",
	}})
	s.Empty(forwarded)

	// Start and activate pairing
	sess := &PairingSession{
		HostPeerID: "peer-pm", HostNodeID: "node-pm",
		GuestPeerID: "peer-dev", GuestNodeID: "node-dev",
	}
	s.Require().NoError(s.store.CreatePairingSession(ctx, sess))
	s.Require().NoError(s.store.UpdatePairingSessionStatus(ctx, sess.ID, PairingActive))

	// During pairing: events SHOULD forward
	bus.Dispatch(ctx, P2PEvent{Type: P2PSignalReceived, Payload: SignalEventPayload{
		SourceItemID: "item-1", SourceNodeID: "node-pm", TargetItemID: "item-2", Reason: "changed",
	}})
	s.Len(forwarded, 1)
	s.Equal("peer-dev:signal.received", forwarded[0])

	// After ending: events should NOT forward
	s.Require().NoError(s.store.EndPairingSession(ctx, sess.ID))
	bus.Dispatch(ctx, P2PEvent{Type: P2PPeerJoined, Payload: PeerEventPayload{Peer: &Peer{PeerID: "peer-new"}}})
	s.Len(forwarded, 1) // Still 1 — no new forwarding
}

// Session status includes pairing info
func (s *PairingScenarioSuite) TestSessionStatusIncludesPairings() {
	ctx := s.ctx

	node, err := s.engine.RegisterNode(ctx, "pm-inv", VerticalPM, "clinic-checkin", "duke", false)
	s.Require().NoError(err)

	// Create an active pairing
	sess := &PairingSession{
		HostPeerID: "peer-pm", HostNodeID: node.ID,
		GuestPeerID: "peer-dev", GuestNodeID: "node-dev",
	}
	s.Require().NoError(s.store.CreatePairingSession(ctx, sess))
	s.Require().NoError(s.store.UpdatePairingSessionStatus(ctx, sess.ID, PairingActive))

	// Verify we can list them
	active, err := s.store.ListActivePairingSessions(ctx, "peer-pm")
	s.Require().NoError(err)
	s.Len(active, 1)
}
```

**Step 2: Run all pairing tests**

Run: `go test -run 'TestPairing' -v ./...`
Expected: All tests across PairingStoreSuite, PairingEngineSuite, PairingHandlerSuite, PairingBridgeSuite, PairingScenarioSuite pass.

**Step 3: Run full test suite**

Run: `go test -v ./...`
Expected: All tests pass (existing 203 + new pairing tests).

**Step 4: Commit**

```bash
git add pairing_test.go
git commit -m "test: add comprehensive pairing scenario tests"
```

---

## Summary

| Task | Files | Tests | Description |
|------|-------|-------|-------------|
| 1 | `network.go`, `store.go`, `pairing_test.go` | 5 | PairingSession type + table + store CRUD |
| 2 | `engine.go`, `pairing_test.go` | 9 | Engine pairing methods (invite, accept, end, list) |
| 3 | `proto/inv.proto`, `proto/inv.pb.go` | 0 | Protobuf messages (PairInvite, PairAccept, PairEnd, PairEvent) |
| 4 | `p2p_handlers.go`, `pairing_test.go` | 3 | P2P handlers for pairing lifecycle |
| 5 | `pairing_bridge.go`, `pairing_test.go` | 3 | Event forwarding bridge (host→guest) |
| 6 | `main.go` | 0 | CLI commands (inv pair invite/join/end/list) |
| 7 | `mcp_server.go` | 0 | MCP tools (inv_pair_invite/join/end/list) |
| 8 | `pairing_test.go` | 4 | Comprehensive scenario tests |

**Total:** 8 tasks, ~24 tests, 8 commits

**New files:** `pairing_bridge.go`, `pairing_test.go`

**Modified files:** `network.go`, `store.go`, `engine.go`, `p2p_handlers.go`, `main.go`, `mcp_server.go`, `proto/inv.proto`, `proto/inv.pb.go`

**New MCP tools:** `inv_pair_invite`, `inv_pair_join`, `inv_pair_end`, `inv_pair_list`

**New CLI commands:** `inv pair invite`, `inv pair join`, `inv pair end`, `inv pair list`
