# inv — Inventory Network

[![Release @tini-works/inv-node](https://github.com/tini-works/my-inventory/actions/workflows/release-node.yml/badge.svg?branch=main)](https://github.com/tini-works/my-inventory/actions/workflows/release-node.yml)

A distributed inventory network for software teams and AI agents. Each team member (PM, design, dev, QA, devops) runs a local node that owns their slice of project artifacts — PRDs, ADRs, tickets, test plans — with automatic state propagation across the network when dependencies change.

Built for the Constitution framework (`tini-works/const`).

## How it works

- Each node owns a local **SQLite database** of items and traces
- Items have a 4-state lifecycle: `unverified → proven → suspect → broke`
- When an item changes, all downstream items are automatically marked `suspect`
- Nodes communicate via a central **WebSocket server** (Redis-backed, multi-instance)
- Each node exposes **19 MCP tools** so Claude can manage the inventory on your behalf
- Nodes use **Claude Code channels** to push real-time events (messages, proposals, challenges) into your Claude session
- Human-in-the-loop: configurable autonomy — Claude can auto-handle some actions and queue others for approval

## Prerequisites

- [Bun](https://bun.sh) 1.0+
- [Docker](https://docker.com) (for the central server)
- A Redis instance (included in docker-compose)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) v2.1.80+

## Install

### Option A: Published package (recommended)

```bash
bunx @tini-works/inv-node init
# Follow the wizard — writes inv-config.json + .mcp.json
```

### Option B: From source

Clone the repo and follow Quick Start below.

## Quick Start

### 1. Start the central server

```bash
docker-compose up -d
```

### 2. Create tokens for your nodes

Via CLI:

```bash
bun run server token create --project my-project --node pm
bun run server token create --project my-project --node dev
```

Or via the admin UI at `http://<server-host>:4400/admin`.

**Important:** The `--node` value (or "Node ID" in the admin UI) is the **routing address**. When one node sends a message to another (e.g. `inv_ask(targetNode: "dev")`), the `targetNode` must exactly match this value. All nodes that need to communicate must share the same `--project`.

### 3. Set up your node

```bash
bunx @tini-works/inv-node init
# Follow the wizard — writes inv-config.json + .mcp.json
```

### 4. Start Claude Code with channels enabled

Channels allow real-time events (messages from other nodes, proposals, challenges) to appear in your Claude session as `<channel source="inventory">` tags.

During the research preview, channels require the development flag:

```bash
claude --dangerously-load-development-channels server:inventory
```

`server:inventory` refers to the MCP server name `"inventory"` in your `.mcp.json`:

```json
{
  "mcpServers": {
    "inventory": {
      "command": "bunx",
      "args": ["@tini-works/inv-node@latest", "serve", "./inv-config.json"]
    }
  }
}
```

Without this flag, Claude can still **send** messages via `inv_ask`/`inv_reply`, but **incoming** events from other nodes won't appear in the session.

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
├── admin/        # React SPA for server management (token, nodes, logs)
└── dashboard/    # Astro SSR action center UI
```

## MCP Tools

19 tools available to Claude:

| Group | Tools |
|---|---|
| Core | `inv_add_item`, `inv_add_trace`, `inv_verify`, `inv_mark_broken`, `inv_audit` |
| Network | `inv_ask`, `inv_reply` |
| Proposals | `inv_proposal_create`, `inv_proposal_vote` |
| Challenges | `inv_challenge_create`, `inv_challenge_respond` |
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
  "node": { "name": "dev-node", "vertical": "dev", "project": "my-project", "owner": "cuong" },
  "server": { "url": "ws://localhost:4400/ws", "token": "..." },
  "autonomy": {
    "auto": ["signal_change", "trace_resolve_request", "sweep", "query_respond"],
    "approval": ["proposal_vote", "challenge_respond", "pair_invite", "cr_create"]
  }
}
```

## V2 Features

- **Change Requests & Voting** — cross-vertical change proposals with tie-breaking by vertical rank
- **Challenges** — dispute an item's state; other verticals vote uphold/dismiss
- **Pairing Sessions** — collaborative sessions between two nodes
- **Checklists** — per-item task lists
- **Channels** — real-time event delivery into Claude Code sessions via `notifications/claude/channel`
- **Observability** — `GET /metrics` on the server returns live counters

## Server CLI

```bash
bun run server start --port 4400 --redis redis://localhost:6379
bun run server token create --project <proj> --node <nodeId>
bun run server token list --project <proj>
bun run server token revoke <token>
```

## Server Admin UI

The admin UI is available at `http://<server-host>:4400/admin` (requires `ADMIN_KEY` env var). From here you can:

- Create and revoke tokens
- View connected nodes
- Monitor server logs

## Tests

```bash
bun test                   # full suite (281+ tests)
bun test packages/server   # server only (requires local Redis)
bun test packages/node     # node only
```

## Tech Stack

- **Bun** — runtime (WebSocket, SQLite, test runner)
- **TypeScript** — full stack
- **Redis** — presence, routing, outbox (via ioredis)
- **SQLite** (`bun:sqlite`) — local node database
- **Astro 5 SSR** — dashboard
- **React** — admin SPA
- **@modelcontextprotocol/sdk** — MCP channel server

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for a full walkthrough.
