# Inventory Tool Design

**Date:** 2026-03-18
**Status:** Approved
**Stack:** Go + SQLite
**Interfaces:** CLI (Cobra) + MCP Server (stdio/SSE)

---

## Context

The team is adopting "The Constitution" framework (from `tini-works/const`) where each vertical (PM, Design, Dev, QA, DevOps) owns an independent **inventory** — a living warehouse of artifacts with traces, lifecycle states, and reconciliation logs.

Rather than managing inventories as static markdown files, this tool provides a structured engine that both humans (CLI) and AI agents (MCP) can use to create, query, audit, and reconcile inventory items.

## Core Capabilities

| Capability | What it does |
|---|---|
| **init** | Scaffold a new inventory for a vertical |
| **add** | Add items with kind, title, body, traces, and metadata |
| **query** | Search items by kind, status, text, or trace path |
| **impact** | "What breaks if X changes?" — follow trace graph |
| **audit** | Health report: missing traces, unverified items, orphans, gaps |
| **sweep** | When upstream changes, mark dependent items as suspect |
| **reconcile** | Re-verify suspect items with evidence, log the outcome |
| **list** | List all items with filters |
| **trace** | Show full trace chain for an item |

## Architecture

```
┌─────────────────────────────────────────────┐
│                  my-inventory                │
│                                             │
│  ┌──────────┐          ┌──────────────────┐ │
│  │   CLI    │          │   MCP Server     │ │
│  │ (Cobra)  │          │ (stdio/SSE)      │ │
│  └────┬─────┘          └────────┬─────────┘ │
│       │                         │           │
│       └──────────┬──────────────┘           │
│                  │                           │
│          ┌───────▼────────┐                 │
│          │   Core Engine   │                 │
│          │                │                 │
│          │ • Inventory    │                 │
│          │ • Items        │                 │
│          │ • Traces       │                 │
│          │ • Lifecycle    │                 │
│          │ • Query        │                 │
│          │ • Audit        │                 │
│          │ • Sweep        │                 │
│          │ • Reconcile    │                 │
│          └───────┬────────┘                 │
│                  │                           │
│          ┌───────▼────────┐                 │
│          │    SQLite DB    │                 │
│          │  inventory.db   │                 │
│          └────────────────┘                 │
└─────────────────────────────────────────────┘
```

## Package Layout

```
my-inventory/
├── cmd/
│   ├── inv/              ← CLI entrypoint
│   │   └── main.go
│   └── inv-mcp/          ← MCP server entrypoint
│       └── main.go
├── internal/
│   ├── engine/           ← Core domain logic
│   │   ├── inventory.go  ← Init, open, configure
│   │   ├── item.go       ← Add, update, delete items
│   │   ├── trace.go      ← Trace management
│   │   ├── lifecycle.go  ← Status transitions (unverified→proven→suspect)
│   │   ├── query.go      ← Query & search
│   │   ├── audit.go      ← Health checks
│   │   ├── sweep.go      ← Change impact analysis
│   │   └── reconcile.go  ← Re-verification workflow
│   ├── store/            ← SQLite layer
│   │   ├── sqlite.go     ← DB setup, migrations
│   │   ├── items.go      ← Item CRUD
│   │   └── traces.go     ← Trace CRUD & graph queries
│   ├── cli/              ← Cobra commands
│   │   ├── root.go
│   │   ├── init.go
│   │   ├── add.go
│   │   ├── query.go
│   │   ├── audit.go
│   │   ├── sweep.go
│   │   └── reconcile.go
│   └── mcp/              ← MCP tool handlers
│       ├── server.go
│       └── tools.go      ← Maps MCP tools → engine calls
├── inventory.db          ← SQLite database (gitignored)
├── go.mod
├── go.sum
└── README.md
```

## Data Model (SQLite)

```sql
CREATE TABLE inventory (
    id          TEXT PRIMARY KEY,
    vertical    TEXT NOT NULL,  -- dev, pm, design, qa, devops
    project     TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE items (
    id           TEXT PRIMARY KEY,
    inventory_id TEXT REFERENCES inventory(id),
    kind         TEXT NOT NULL,  -- adr, api-spec, data-model, tech-design, etc.
    title        TEXT NOT NULL,
    body         TEXT,           -- full content (markdown)
    status       TEXT DEFAULT 'unverified',  -- unverified, proven, suspect
    evidence     TEXT,           -- proof that this item is verified
    confirmed_by TEXT,
    confirmed_at DATETIME,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE traces (
    id           TEXT PRIMARY KEY,
    from_item    TEXT REFERENCES items(id),
    to_ref       TEXT NOT NULL,  -- item ID, external ref, or origin description
    relation     TEXT NOT NULL,  -- traced_from, matched_by, proven_by
    confirmed_by TEXT,
    confirmed_at DATETIME,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE reconciliation_log (
    id             TEXT PRIMARY KEY,
    inventory_id   TEXT REFERENCES inventory(id),
    trigger_ref    TEXT NOT NULL,  -- what changed
    summary        TEXT NOT NULL,
    items_affected TEXT,           -- JSON array of item IDs
    assessed_by    TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## MCP Tools

| Tool | Description |
|---|---|
| `inv_init` | Initialize a new inventory for a vertical |
| `inv_add` | Add an item with kind, title, body, traces |
| `inv_query` | Search items by kind, status, text, or trace path |
| `inv_impact` | Follow trace graph to find affected items |
| `inv_audit` | Return health report |
| `inv_sweep` | Mark items suspect based on upstream change |
| `inv_reconcile` | Update item status with evidence |
| `inv_list` | List all items with filters |
| `inv_trace` | Show full trace chain for an item |

## CLI Commands

```
inv init --vertical dev --project clinic-checkin
inv add adr --title "WebSocket for real-time" --traced-from "BUG-001"
inv add tech-design --title "Session isolation" --traced-from "BUG-002"
inv list --status unverified
inv query "what uses the check-in API?"
inv audit
inv sweep --changed "US-003"
inv reconcile ADR-002 --status proven --evidence "Load test passed, see results/"
inv trace ADR-002
```

## Implementation Order

1. **Phase 1:** Core engine + SQLite store + `init` and `add` commands
2. **Phase 2:** `list`, `query`, `trace` commands
3. **Phase 3:** `audit`, `sweep`, `reconcile` commands
4. **Phase 4:** MCP server wrapping the same engine
5. **Phase 5:** Cross-inventory features (connecting to PM/Designer inventories)
