# Phase 2 Design: Feature Completion + Testing + Polish

**Date:** 2026-03-18
**Status:** Approved
**Depends on:** 2026-03-18-inventory-tool-design.md (original design)

---

## Context

The core inventory network is implemented: nodes, items, traces, lifecycle state machine, signal propagation, change requests with voting, network queries, CLI (Cobra), MCP server, and DI via pumped-go. All code compiles and lives in a flat package at the root.

This design covers four areas in order:
1. Missing features (query, sweep, reconcile, trace chain)
2. Testing strategy
3. CLI polish (dual zerolog output)

---

## 1. Query — Text Search + Structured Filters

Combined text search and structured filters on items.

### New field: `external_ref`

Add an optional `external_ref` field to the `items` table and `Item` struct. Used by both query and sweep.

```sql
ALTER TABLE items ADD COLUMN external_ref TEXT DEFAULT '';
```

### Updated signatures

```go
// Item struct — add field
type Item struct {
    // ... existing fields ...
    ExternalRef string    `json:"external_ref"`
}

// Engine — updated signature
func (e *Engine) AddItem(ctx context.Context, nodeID string, kind ItemKind, title string, body string, externalRef string) (*Item, error)
```

### CLI update

```bash
inv item add --node <id> --kind adr --title "WebSocket design" --external-ref "US-003"
```

`--external-ref` is optional, defaults to empty string.

### MCP update

`inv_add_item` gains an optional `external_ref` string parameter.

### Engine

```go
type QueryFilter struct {
    Text        string     // LIKE match on title + body
    Kind        ItemKind   // exact match
    Status      ItemStatus // exact match
    NodeID      string     // scope to node
    ExternalRef string     // exact match on external ref
}

func (e *Engine) QueryItems(ctx context.Context, f QueryFilter) ([]Item, error)
```

Filters are combined with AND. Empty fields are ignored. Text search uses SQLite `LIKE` (no FTS module needed).

### Store

```go
func (s *Store) QueryItems(ctx context.Context, f QueryFilter) ([]Item, error)
```

Builds a dynamic WHERE clause from non-empty filter fields. Text filter applies `(title LIKE ? OR body LIKE ?)` with `%text%`.

### CLI

```
inv query "session" --kind adr --status proven --node <id>
```

Output: JSON array via agent logger. Empty array if no matches.

### MCP

`inv_query` with all filter params optional.

---

## 2. Sweep — External Ref Based Impact Propagation

When an external artifact changes (e.g., a user story in PM's system), sweep finds all items referencing it and marks their dependents suspect.

### How it works

1. Find all items where `external_ref = <ref>` across all nodes
2. For each matched item, compute impact via trace graph (reuse `ComputeImpact`)
3. Mark every dependent as `suspect` via the state machine
4. Record transitions for each affected item
5. Return a `SweepResult`

### Engine

```go
type SweepResult struct {
    TriggerRef    string `json:"trigger_ref"`
    MatchedItems  []Item `json:"matched_items"`
    AffectedItems []Item `json:"affected_items"`
    SignalsCreated int   `json:"signals_created"`
}

func (e *Engine) Sweep(ctx context.Context, externalRef string) (*SweepResult, error)
```

### Store

```go
func (s *Store) FindItemsByExternalRef(ctx context.Context, ref string) ([]Item, error)
```

### Edge cases

- If a matched item is already `suspect` or `broke`, its dependents still get checked but the item itself is not transitioned again.

### CLI

```
inv sweep --ref "US-003"
```

Output: JSON `SweepResult` via agent logger.

### MCP

`inv_sweep` with `ref` param.

---

## 3. Reconcile — Session-Based Re-verification

Reconciliation groups re-verifications after a sweep into auditable sessions.

### New types

```go
type ReconciliationSession struct {
    ID          string                `json:"id"`
    TriggerRef  string                `json:"trigger_ref"`
    NodeID      string                `json:"node_id"`
    Status      string                `json:"status"` // "open", "completed"
    Entries     []ReconciliationEntry `json:"entries"`
    StartedBy   string                `json:"started_by"`
    StartedAt   time.Time             `json:"started_at"`
    CompletedAt *time.Time            `json:"completed_at,omitempty"`
}

type ReconciliationEntry struct {
    ID        string    `json:"id"`
    SessionID string    `json:"session_id"`
    ItemID    string    `json:"item_id"`
    Decision  string    `json:"decision"` // "re_verified", "marked_broke", "deferred"
    Evidence  string    `json:"evidence"`
    Actor     string    `json:"actor"`
    CreatedAt time.Time `json:"created_at"`
}
```

### New tables

```sql
CREATE TABLE IF NOT EXISTS reconciliation_sessions (
    id          TEXT PRIMARY KEY,
    trigger_ref TEXT NOT NULL,
    node_id     TEXT NOT NULL REFERENCES nodes(id),
    status      TEXT DEFAULT 'open',
    started_by  TEXT NOT NULL,
    started_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

CREATE TABLE IF NOT EXISTS reconciliation_entries (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES reconciliation_sessions(id),
    item_id    TEXT NOT NULL REFERENCES items(id),
    decision   TEXT NOT NULL,
    evidence   TEXT DEFAULT '',
    actor      TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Migration from `reconciliation_log`

The existing `reconciliation_log` table is superseded by the session-based model above. Migration:

```sql
DROP TABLE IF EXISTS reconciliation_log;
```

All new reconciliation data uses `reconciliation_sessions` and `reconciliation_entries`. The old single-row-per-reconciliation model lacked per-item granularity.

### Workflow

1. `inv reconcile start --ref "US-003" --node <id> --actor cuong` — creates a session, finds all suspect items in that node linked to the sweep trigger
2. `inv reconcile resolve <item-id> --session <id> --decision re_verified --evidence "Tested, still valid" --actor cuong` — records entry, transitions item via state machine
3. `inv reconcile complete <session-id>` — marks session completed

### Engine

```go
func (e *Engine) StartReconciliation(ctx context.Context, triggerRef, nodeID, actor string) (*ReconciliationSession, error)
func (e *Engine) ResolveItem(ctx context.Context, sessionID, itemID, decision, evidence, actor string) (*ReconciliationEntry, error)
func (e *Engine) CompleteReconciliation(ctx context.Context, sessionID string) (*ReconciliationSession, error)
```

### CLI

```
inv reconcile start --ref "US-003" --node <id> --actor cuong
inv reconcile resolve <item-id> --session <id> --decision re_verified --evidence "..." --actor cuong
inv reconcile complete <session-id>
```

### MCP

`inv_reconcile_start`, `inv_reconcile_resolve`, `inv_reconcile_complete`.

---

## 4. Trace Up / Trace Down

Two commands for navigating the trace graph directionally.

### Engine

```go
type TraceChainEntry struct {
    Depth    int           `json:"depth"`
    Item     Item          `json:"item"`
    Relation TraceRelation `json:"relation"`
    NodeID   string        `json:"node_id"`
}

func (e *Engine) TraceUp(ctx context.Context, itemID string) ([]TraceChainEntry, error)
func (e *Engine) TraceDown(ctx context.Context, itemID string) ([]TraceChainEntry, error)
```

- `TraceUp` — "What does this item depend on?" Finds traces where `from_item_id = <itemID>` (this item traces TO something), then follows each `to_item_id` upstream. Recursively walks upward.
- `TraceDown` — "What depends on this item?" Finds traces where `to_item_id = <itemID>` (something traces FROM this item), then follows each `from_item_id` downstream. Recursively walks downward. This reuses the existing `GetDependentTraces` method.

Both use BFS with cycle detection (visited map). Depth field indicates hops from origin.

### Store

```go
// GetUpstreamTraces returns traces where this item is the source (from_item_id = itemID)
func (s *Store) GetUpstreamTraces(ctx context.Context, itemID string) ([]Trace, error)
// SQL: SELECT ... FROM traces WHERE from_item_id = ?

// GetDependentTraces already exists — returns traces where this item is the target (to_item_id = itemID)
// SQL: SELECT ... FROM traces WHERE to_item_id = ?
```

### CLI

```
inv trace up <item-id>
inv trace down <item-id>
```

Output: JSON array of `TraceChainEntry`, ordered by depth.

### MCP

`inv_trace_up` and `inv_trace_down`, each with `item_id` param.

---

## 5. Testing Strategy

### Layer 1 — Unit tests (pure logic, no DB)

**`state_test.go`:**
- Item state machine: all 5 transitions (verify, suspect, re_verify, break, fix)
- Invalid transitions (e.g., unverified → broke)
- Missing evidence/reason/actor validation
- CR state machine: full lifecycle (draft → proposed → voting → approved → applied → archived)
- Invalid CR transitions

### Layer 2 — Integration tests (in-memory SQLite)

**`store_test.go`:**
- CRUD for every entity: nodes, items, traces, signals, transitions, CRs, votes, queries, reconciliation sessions/entries
- QueryItems with all filter combinations (text, kind, status, node, external_ref)
- FindItemsByExternalRef
- GetUpstreamTraces, GetDependentTraces

### Layer 3 — Engine integration tests (in-memory SQLite)

**`engine_test.go`:**
- Signal propagation: single hop, multi-hop, cycle detection, skip non-proven items
- Note: `PropagateChange` currently uses DFS recursion with no visited set. Implementation must add a `visited map[string]bool` parameter (like `ComputeImpact` already has) to prevent infinite recursion on circular trace graphs.
- Sweep: finds by external ref, marks dependents, returns correct SweepResult
- Reconciliation: start session → resolve items → complete session
- TraceUp / TraceDown: chain traversal, depth correctness, cross-node traces

### Layer 4 — Scenario tests (full workflows)

**`scenario_test.go`:**
- **"PM changes spec"**: PM node adds user story with external_ref → Dev traces ADR to it → PM sweeps the ref → Dev reconciles
- **"Cross-team CR"**: Dev creates CR → submits → votes from PM + QA → resolve → apply
- **"Deep propagation"**: Chain of 4 items across 3 nodes → change at root → all marked suspect → reconcile from leaf up

### Test helper

```go
func newTestEngine(t *testing.T) *Engine
```

Creates in-memory SQLite store (`:memory:`), wires up engine with all dependencies, registers `t.Cleanup` for teardown.

---

## 6. CLI Polish — Dual Zerolog Output

### New dependency

`github.com/rs/zerolog`

### Two loggers

```go
// System logger — stderr, diagnostics for human operators
var SystemLogger = pumped.Provide(func(ctx *pumped.ResolveCtx) (*zerolog.Logger, error) {
    logger := zerolog.New(os.Stderr).With().Timestamp().Str("source", "system").Logger()
    return &logger, nil
})

// Agent logger — stdout, structured JSON for scripts/MCP/AI agents
var AgentLogger = pumped.Provide(func(ctx *pumped.ResolveCtx) (*zerolog.Logger, error) {
    logger := zerolog.New(os.Stdout).With().Str("source", "agent").Logger()
    return &logger, nil
})
```

### Config

```go
type AppConfig struct {
    DBPath      string
    Project     string
    SystemLevel zerolog.Level // default: info
    AgentLevel  zerolog.Level // default: info
}
```

Levels are independent. Agent output can be `info`-only (clean data). System can be `debug` in dev, `warn` in prod.

### Usage pattern

```go
// Data output — consumed by agents, piped to jq
agentLog.Info().RawJSON("data", itemJSON).Str("command", "item.add").Msg("item created")

// Diagnostics — human reads stderr
sysLog.Error().Err(err).Str("node_id", nodeID).Msg("failed to list items")
sysLog.Info().Str("item_id", itemID).Int("signals", len(signals)).Msg("propagation complete")
```

### Removals

Delete `printJSON`, `output`, `outputError` helpers. All output goes through one of the two loggers.

### Rule

No `fmt.Fprintf(os.Stderr, ...)` or `log.*` anywhere. Only `agentLog` (stdout) and `sysLog` (stderr).

---

## Implementation Order

1. **Add `external_ref` field** — schema migration, update Item struct, update CreateItem/AddItem
2. **Query** — store method, engine method, CLI command, MCP tool
3. **Sweep** — store method, engine method, CLI command, MCP tool
4. **Reconcile** — new tables, new types, store methods, engine methods, CLI subcommands, MCP tools
5. **Trace up/down** — store method, engine methods, CLI subcommands, MCP tools
6. **Dual zerolog** — add dependency, create loggers in DI, refactor all commands
7. **Tests layer 1** — state machine unit tests
8. **Tests layer 2** — store integration tests
9. **Tests layer 3** — engine integration tests
10. **Tests layer 4** — scenario tests

**Note:** The existing `Engine.MarkBroken` method has no CLI command or MCP tool. These should be added as part of Phase 2:

CLI:
```bash
inv mark-broken <item-id> --reason "API contract changed" --actor cuong
```

MCP: `inv_mark_broken` with `item_id` (required), `reason` (required), `actor` (required).
