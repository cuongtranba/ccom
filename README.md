# inv — Inventory Network

A distributed inventory network for software teams and AI agents. Each team member (PM, design, dev, QA, devops) runs a local node that owns their slice of project artifacts — PRDs, ADRs, tickets, test plans — with automatic state propagation across the network when dependencies change.

Built for the Constitution framework (`tini-works/const`).

## How it works

- Each node owns a local **SQLite database** of items and traces
- Items have a 4-state lifecycle: `unverified → proven → suspect → broke`
- When an item changes, all downstream items are automatically marked `suspect`
- Nodes communicate via a central **WebSocket server** (Redis-backed, multi-instance)
- Each node exposes **19 MCP tools** so Claude can manage the inventory on your behalf
- Human-in-the-loop: configurable autonomy — Claude can auto-handle some actions and queue others for approval

## Prerequisites

- [Bun](https://bun.sh) 1.0+
- [Docker](https://docker.com) (for the central server)
- A Redis instance (included in docker-compose)

## Quick Start

### 1. Start the central server

```bash
docker-compose up -d
```

### 2. Create a token for your node

```bash
bun run server token create --project my-project --node my-node
```

### 3. Set up your node

```bash
bun run init
# Follow the wizard — writes inv-config.json
```

### 4. Connect Claude

```bash
bun run node    # starts the MCP server on stdio
claude          # Claude connects automatically via .mcp.json
```

### 5. Dashboard (optional)

```bash
cd packages/dashboard && bun run dev
# Open http://localhost:4322
```

## Packages

```
packages/
├── shared/       # Types + message envelope
├── server/       # Central WebSocket server (deploy to Dokploy)
├── node/         # Node client — engine, store, MCP server
└── dashboard/    # Astro SSR action center UI
```

## MCP Tools

19 tools available to Claude:

| Group | Tools |
|---|---|
| Core | `inv_add_item`, `inv_add_trace`, `inv_verify`, `inv_mark_broken`, `inv_sweep`, `inv_impact`, `inv_audit` |
| Network | `inv_list_nodes`, `inv_network_status`, `inv_register_node`, `inv_pending_events`, `inv_session_status` |
| Proposals | `inv_proposal_create`, `inv_proposal_vote` |
| Challenges | `inv_challenge_create`, `inv_challenge_list`, `inv_challenge_respond` |
| Pairing | `inv_pair_invite`, `inv_pair_join`, `inv_pair_end`, `inv_pair_list` |
| Checklist | `inv_checklist_add`, `inv_checklist_check`, `inv_checklist_uncheck`, `inv_checklist_list` |

## Item Lifecycle

```
unverified → proven → suspect → broke
```

When a node propagates a change, all items that trace to the changed item are automatically marked `suspect`.

## Autonomy Config

`inv-config.json` controls which actions Claude handles automatically vs. queues for human approval:

```json
{
  "node": { "id": "...", "name": "dev-node", "vertical": "dev", "project": "my-project" },
  "server": { "url": "ws://localhost:4400/ws", "token": "..." },
  "autonomy": {
    "auto": ["signal_change", "trace_resolve", "sweep", "query_respond"],
    "approval": ["proposal_vote", "challenge_respond", "pair_invite", "cr_create"]
  }
}
```

Approval-required actions are queued in SQLite and visible in the dashboard at `localhost:4322`.

## V2 Features

- **Change Requests & Voting** — cross-vertical change proposals with tie-breaking by vertical rank
- **Challenges** — dispute an item's state; other verticals vote uphold/dismiss
- **Pairing Sessions** — collaborative sessions between two nodes
- **Checklists** — per-item task lists
- **Kind Mapping** — translate item kinds across verticals (e.g. `dev:adr` → `pm:decision`)
- **Observability** — `GET /metrics` on the server returns live counters

## Server CLI

```bash
bun run server start --port 4400 --redis redis://localhost:6379
bun run server token create --project <proj> --node <nodeId>
bun run server token list --project <proj>
bun run server token revoke <token>
```

## Tests

```bash
bun test                   # full suite (334 tests)
bun test packages/server   # server only (requires local Redis)
bun test packages/node     # node only
```

## Tech Stack

- **Bun** — runtime (WebSocket, SQLite, test runner)
- **TypeScript** — full stack
- **Redis** — presence, routing, outbox (via ioredis)
- **SQLite** (`bun:sqlite`) — local node database
- **Astro 5 SSR** — dashboard
- **@modelcontextprotocol/sdk** — MCP channel server

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for a full walkthrough.
