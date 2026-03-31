# Architecture Overview

## What is this?

**my-inventory** is a distributed inventory network for software teams. Each team member (PM, dev, design, QA, devops) runs a local "node" that owns their slice of project artifacts — PRDs, ADRs, tickets, test plans, etc. Nodes stay in sync by propagating signals when something changes: if a PM updates a PRD, every downstream item that traces to it is automatically marked `suspect` and the owning node is notified.

The AI angle: nodes integrate with Claude via MCP. Each node exposes 19 tools to Claude — so an AI assistant can query the inventory, propose changes, vote on decisions, and manage pending approvals on behalf of its owner.

---

## Packages

```
my-inventory/
├── packages/
│   ├── shared/       # Types + message envelope (no runtime logic)
│   ├── server/       # Central WebSocket server (deploy to Dokploy)
│   ├── node/         # Node client (runs on each team member's machine)
│   └── dashboard/    # Astro SSR action center UI (port 4322)
├── web/              # Landing page (static, separate)
├── docker-compose.yml
└── inv-config.example.json
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│           Central Server (Bun)                   │
│   WebSocket endpoint  ·  Redis hub/outbox/auth   │
│   GET /metrics        ·  Deployed on Dokploy     │
└──────────┬────────────────────────┬──────────────┘
           │ ws://                  │ ws://
           ▼                        ▼
┌─────────────────────┐  ┌─────────────────────┐
│   Node A (Bun)      │  │   Node B (Bun)      │
│  Engine + Store     │  │  Engine + Store     │
│  SQLite (local)     │  │  SQLite (local)     │
│  MCP channel server │  │  MCP channel server │
│  19 tools for Claude│  │  19 tools for Claude│
└─────────────────────┘  └─────────────────────┘
           │
           │ Claude connects via MCP
           ▼
┌─────────────────────┐
│  packages/dashboard │
│  Astro SSR          │
│  Action Center UI   │
└─────────────────────┘
```

---

## packages/server

Stateless Bun process. Three Redis-backed services:

| Class | Responsibility |
|---|---|
| `RedisAuth` | Project-scoped token CRUD |
| `RedisHub` | Presence tracking, message routing, cross-instance pub/sub |
| `RedisOutbox` | Queues messages for offline nodes, drains on reconnect |

**Routing logic in `RedisHub.deliverTo`:**
1. Node online on this instance → `ws.send()` directly
2. Node online on another instance → publish to `route:{projectId}` Redis channel
3. Node offline → `RPUSH` to `outbox:{projectId}:{nodeId}`

On reconnect: `open` handler calls `drainOutbox`, delivering all queued messages in FIFO order.

**Endpoints:**
- `GET /ws?token=<token>` — WebSocket upgrade
- `GET /metrics` — JSON snapshot: `messages_routed`, `messages_enqueued`, `messages_cross_instance`, `connections_active`, `drains_total`, `drain_messages_total`

**CLI:**
```bash
bun run server start --port 4400 --redis redis://localhost:6379
bun run server token create --project <proj> --node <nodeId>
bun run server token list --project <proj>
bun run server token revoke <token>
```

---

## packages/node

Runs on each team member's machine. Owns a local SQLite database.

### Core files

| File | Responsibility |
|---|---|
| `state.ts` | `StateMachine` (item lifecycle) + `CRStateMachine` (CR lifecycle) |
| `store.ts` | All SQLite CRUD — nodes, items, traces, CRs, votes, pairs, checklists |
| `signal.ts` | `SignalPropagator` — recursive downstream cascade on state change |
| `engine.ts` | Orchestrates store + state + signal. All domain operations live here |
| `config.ts` | Reads `inv-config.json` — node identity, server URL, autonomy rules |
| `event-bus.ts` | Typed in-process pub/sub for network events |
| `ws-client.ts` | WebSocket connection + exponential backoff reconnect |
| `ws-handlers.ts` | Dispatches incoming envelopes to engine methods |
| `channel.ts` | MCP server — exposes 19 tools to Claude, bridges EventBus → MCP |
| `logger.ts` | Structured JSON logger (stderr), `{ ts, level, logger, msg, ...data }` |

### Item lifecycle

```
unverified → proven → suspect → broke
```

- `unverified` — newly created
- `proven` — owner verified against external reality
- `suspect` — a dependency changed; needs re-verification
- `broke` — explicitly marked broken

### Trace graph

Items are linked by directed traces:
```
PRD ←── ADR ←── Test Plan ←── Ticket
```
Relations: `traced_from`, `depends_on`, `validated_by`.

`SignalPropagator` walks this graph on every state change and marks all downstream items `suspect`.

### Autonomy config

`inv-config.json` sets which message types Claude handles automatically vs. which queue for human approval:

```json
{
  "autonomy": {
    "auto": ["signal_change", "trace_resolve", "sweep", "query_respond"],
    "approval": ["proposal_vote", "challenge_respond", "pair_invite", "cr_create"]
  }
}
```

Approval-required messages are stored in `pending_actions` (SQLite) until acted on.

---

## V2 Features

### Change Requests & Voting

A CR is raised when a node wants to modify an item owned by another vertical.

```
draft → proposed → voting → approved/rejected → applied → archived
```

Each vertical casts one vote. Tie-breaking uses `UPSTREAM_VERTICALS` (PM > design > dev > QA > devops). Result is broadcast as `proposal_result`.

### Challenges

A challenge is a CR with `description` prefixed `"Challenge:"`. Verticals vote to **uphold** (item goes `suspect` + cascades) or **dismiss** (archived). Reuses the full CR/voting machinery.

### Pairing Sessions

Two nodes open a collaborative session: `invite → join → end`. Tracked in `pair_sessions` with status `pending → active → ended`.

### Checklists

Per-item task lists. Any node can add/check/uncheck items. Stored in `checklist_items`.

### Kind Mapping

Translates item kinds across verticals — e.g. `dev:adr` → `pm:decision`. Stored in `kind_mappings`.

---

## MCP Tools (19 total)

| Group | Tools |
|---|---|
| Core | `inv_add_item`, `inv_add_trace`, `inv_verify`, `inv_mark_broken`, `inv_sweep`, `inv_impact`, `inv_audit` |
| Network | `inv_list_nodes`, `inv_network_status`, `inv_register_node`, `inv_pending_events`, `inv_session_status` |
| Proposals | `inv_proposal_create`, `inv_proposal_vote` |
| Challenges | `inv_challenge_create`, `inv_challenge_list`, `inv_challenge_respond` |
| Pairing | `inv_pair_invite`, `inv_pair_join`, `inv_pair_end`, `inv_pair_list` |
| Checklist | `inv_checklist_add`, `inv_checklist_check`, `inv_checklist_uncheck`, `inv_checklist_list` |

---

## packages/dashboard

Astro SSR web app (port 4322) reading the same SQLite database directly via `bun:sqlite`.

**Sections:**
- **Pending Authorizations** — approve or reject queued actions
- **Council Votes** — cast votes on active CRs
- **Active Challenges** — respond to challenges
- **Pair Invitations** — accept or decline pairing requests

**API routes:**
- `POST /api/pending/[id]` — update pending action status
- `POST /api/vote` — cast a vote

DB path resolved from `INV_DB_PATH` env → `inv-config.json` → `./inventory.db`.

---

## End-to-End Message Flow

```
Claude calls inv_proposal_create
  → channel.ts handles tool call
  → engine.createCR() stores in SQLite
  → ws-client broadcasts proposal_create envelope
  → server routes to all online nodes in project
      online: ws.send() directly
      offline: queued in Redis outbox → delivered on reconnect
  → receiving nodes: ws-handlers → engine.receiveProposal()
  → EventBus fires proposal_create
  → autonomy config: auto-vote OR queue as pending_action
  → pending_action visible in dashboard at localhost:4322
```

---

## Running Locally

```bash
# 1. Start server + Redis
docker-compose up -d

# 2. Create a token
bun run server token create --project my-project --node dev-node

# 3. First-time node setup
bun run init                    # writes inv-config.json

# 4. Start node (MCP server on stdio)
bun run node

# 5. Connect Claude
claude                          # picks up MCP config automatically

# 6. Dashboard (optional)
cd packages/dashboard && bun run dev   # http://localhost:4322
```

---

## Test Coverage

334 tests, 4 skipped (Docker E2E — requires live server), 0 failures.
925 `expect()` calls across 18 test files.

```bash
bun test                        # full suite
bun test packages/server        # server only (requires local Redis)
bun test packages/node          # node only
```
