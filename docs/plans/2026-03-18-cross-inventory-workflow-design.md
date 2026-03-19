# Cross-Inventory Workflow Design

**Date:** 2026-03-18
**Status:** Approved
**Depends on:** 2026-03-18-p2p-network-design.md, 2026-03-18-phase2-design.md

---

## Context

The team workflow follows a PM → Designer → Dev pipeline where each vertical runs their own inventory node. PMs iterate on customer requirements, Designers create designs referencing PM outputs, and Devs create architecture referencing both PM and Designer outputs.

Each vertical maintains their own checklist (compliance, UI/UX, architecture standards) with proof per entry. Communication happens over P2P — no shared databases, no file path coupling. Duke expects continuous pairing for real-time collaboration instead of async back-and-forth.

c3-skill (`.c3/` architecture docs) is optional reference documentation. Claude code + MCP can navigate any local files for context. The inventory tool is the core governance system.

---

## 1. Checklist Model

Each item gets a list of checklist entries. Each entry has a criterion name, a checked boolean, and proof text.

### New table

```sql
CREATE TABLE IF NOT EXISTS checklist_entries (
    id         TEXT PRIMARY KEY,
    item_id    TEXT NOT NULL REFERENCES items(id),
    criterion  TEXT NOT NULL,
    checked    INTEGER DEFAULT 0,
    proof      TEXT DEFAULT '',
    checked_by TEXT DEFAULT '',
    checked_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_checklist_item ON checklist_entries(item_id);
```

### Go types

```go
type ChecklistEntry struct {
    ID        string     `json:"id"`
    ItemID    string     `json:"item_id"`
    Criterion string     `json:"criterion"`
    Checked   bool       `json:"checked"`
    Proof     string     `json:"proof"`
    CheckedBy string     `json:"checked_by"`
    CheckedAt *time.Time `json:"checked_at,omitempty"`
    CreatedAt time.Time  `json:"created_at"`
}
```

### Why a separate table

- Queryable: "which items have unchecked entries?" is a single SQL query
- Individual proof per entry (actor, timestamp, evidence)
- Checklist entries can be added/checked independently without updating the whole item
- Audit trail: who checked what and when

### Checklist isolation

Each vertical's checklist entries belong to their items, which belong to their node. PM's compliance checklist stays in PM's SQLite. Designer's UI/UX checklist stays in Designer's SQLite. No merging.

---

## 2. Cross-Inventory References via P2P

Each vertical runs their own inventory node. References to upstream outputs are cross-node traces resolved over P2P.

### How Designer references PM outputs

1. Designer's claude code queries PM's node: `inv ask "What are the outputs for kiosk check-in?"`
2. PM's node responds with item list (ID, title, kind, status, checklist summary)
3. Designer creates their own items, then adds cross-node traces: `inv trace add --from <designer-item> --to <pm-node>:<pm-item>`
4. These traces are the "reference links" the workflow requires

### How Dev references PM + Designer outputs

Same flow — Dev queries both PM and Designer nodes, creates items, traces to both.

### What crosses the wire (P2P)

- Item metadata: ID, title, kind, status, checklist summary (checked/total counts)
- NOT: full body content, proof text, local files

### What stays local

- Full item body, evidence, checklist proof details
- Any local files (.c3/, code, docs)
- Claude code can read local files for its own context, but doesn't share them over P2P

### Mandatory reference enforcement

The audit system gains a new check — items in Designer/Dev inventories must have at least one upstream trace:

```go
// In AuditReport
MissingUpstreamRefs []string `json:"missing_upstream_refs"`
```

Audit flags Designer items with zero traces to PM nodes, and Dev items with zero traces to PM or Designer nodes.

---

## 3. Checklist Summary Over P2P

When a downstream vertical queries an upstream node, they see checklist status — summary only, not full proof details.

### P2P response types

```go
type ItemSummary struct {
    ID        string           `json:"id"`
    NodeID    string           `json:"node_id"`
    Kind      ItemKind         `json:"kind"`
    Title     string           `json:"title"`
    Status    ItemStatus       `json:"status"`
    Checklist ChecklistSummary `json:"checklist"`
}

type ChecklistSummary struct {
    Total   int      `json:"total"`
    Checked int      `json:"checked"`
    Items   []string `json:"items"` // criterion names only, no proof
}
```

### Example P2P exchange

```
Dev → PM node: "What are your outputs for clinic-checkin?"

PM node responds:
[
  {
    "id": "abc-123",
    "title": "Kiosk check-in flow",
    "kind": "user-story",
    "status": "proven",
    "checklist": {
      "total": 3,
      "checked": 2,
      "items": ["HIPAA compliant ✓", "Supports offline ✓", "Accessibility reviewed ✗"]
    }
  }
]
```

### Why only summary over the wire

- Ownership is sacred — proof details (who checked, evidence text) stay in the owning node
- Downstream verticals need to know *what* was checked, not *how* it was proven
- If they need proof details, they use `inv ask` to request specific evidence — the owner decides whether to share

### Checklist status affects traceability decisions

Dev sees PM's item has 2/3 checked. Dev can still trace to it, but the unchecked criterion is visible — Dev knows what's not yet validated upstream.

---

## 4. Continuous Pairing via P2P Sessions

Real-time collaboration between two nodes during iteration, replacing async back-and-forth.

### Pairing session model

```go
type PairingSession struct {
    ID          string     `json:"id"`
    HostNodeID  string     `json:"host_node_id"`
    GuestNodeID string     `json:"guest_node_id"`
    Status      string     `json:"status"` // "active", "ended"
    StartedAt   time.Time  `json:"started_at"`
    EndedAt     *time.Time `json:"ended_at,omitempty"`
}
```

### How it works

1. PM invites: `inv pair invite --node <designer-node>`
2. Designer accepts: `inv pair join <session-id>`
3. While paired, PM's node streams events to Designer's node — item created, item verified, checklist entry checked
4. Designer's claude code receives these via MCP notifications and shows them in real-time
5. Either side ends: `inv pair end <session-id>`

### What pairing adds over regular P2P

- **Live event stream** — no polling. Uses a persistent libp2p stream between the two nodes
- **Elevated access** — guest can query host's items directly without `inv ask` round-trips
- **Scoped** — pairing is between two specific nodes, not broadcast to the whole network

### What pairing does NOT do

- No shared editing — each vertical still owns their own items
- No write access — guest reads host's inventory, creates items in their own

---

## 5. Full PM → Designer → Dev Workflow

### Phase 1: PM iterates on requirements

```
PM (Duke):
1. inv init --vertical pm --project clinic-checkin
2. Creates items: user stories, requirements, epics
3. Adds checklist entries per item:
   inv checklist add <item-id> --criterion "HIPAA compliant"
   inv checklist check <item-id> --criterion "HIPAA compliant" --proof "Legal review v2.1" --actor duke
4. Verifies items with evidence
5. When ready for Designer: inv pair invite --node <designer-node>
```

### Phase 2: Designer creates designs (paired with PM)

```
Designer (Huy):
1. inv pair join <session-id>  → sees PM's items streaming in
2. Queries PM: "What outputs need design?" → gets ItemSummary with checklist
3. Creates own items: screen specs, wireframes, transitions
4. Traces each to PM outputs: inv trace add --from <screen-spec> --to <pm-node>:<user-story>
5. Adds own checklist: "UI/UX reviewed", "Transitions smooth", "Responsive"
6. Verifies items, ends pairing session
```

### Phase 3: Dev creates architecture (paired with PM + Designer)

```
Dev (Cuong):
1. Pairs with both PM and Designer nodes
2. Queries both: gets item summaries + checklist statuses
3. Creates own items: ADRs, API specs, data models
4. Traces to BOTH upstream:
   inv trace add --from <adr> --to <pm-node>:<user-story>
   inv trace add --from <adr> --to <design-node>:<screen-spec>
5. Adds own checklist: "Architecture reviewed", "Coding standards", "Test coverage"
6. Verifies items
```

### Audit enforces the rules

- Designer items without PM traces → flagged
- Dev items without PM or Designer traces → flagged
- Items with unchecked checklist entries → flagged as incomplete

---

## 6. Implementation Delta

### Already done (no changes needed)

- Node per vertical with SQLite
- Items with kind, status, lifecycle state machine
- Traces across nodes
- Signal propagation (upstream change → dependents suspect)
- Change requests with voting
- P2P network design (libp2p, store-and-forward)
- MCP server
- Audit reports

### New — Checklist system

- `checklist_entries` table + `ChecklistEntry` type
- Engine methods: `AddChecklistEntry`, `CheckEntry`, `UncheckEntry`, `GetItemChecklist`
- Store CRUD for checklist entries
- CLI: `inv checklist add/check/uncheck/list`
- MCP: `inv_checklist_add`, `inv_checklist_check`, `inv_checklist_list`

### New — Pairing sessions

- `pairing_sessions` table + `PairingSession` type
- Persistent libp2p stream for live event streaming
- Engine methods: `InvitePair`, `JoinPair`, `EndPair`
- CLI: `inv pair invite/join/end`
- MCP: `inv_pair_invite`, `inv_pair_join`, `inv_pair_end`

### New — Item summary for P2P

- `ItemSummary` type with `ChecklistSummary`
- P2P query response includes checklist counts
- New protobuf message: `ItemSummaryResponse`

### Modified — Audit enhancements

- `MissingUpstreamRefs` check: Designer items must trace to PM, Dev items must trace to PM + Designer
- `IncompleteChecklists` check: items with unchecked entries
- Vertical-aware rules (knows which verticals are "upstream" of which)

### Not needed

- No c3-skill hard integration (c3 is optional, claude code reads files directly)
- No `c3_path` field
- No `inv sync-c3`

---

## Implementation Order

1. Checklist system (table, types, store, engine, CLI, MCP)
2. Item summary types + checklist summary
3. Audit enhancements (missing upstream refs, incomplete checklists)
4. Pairing sessions (table, types, engine, CLI, MCP)
5. P2P pairing stream (persistent libp2p stream, event forwarding)
6. Protobuf messages for item summary and pairing
7. Tests for all new features
