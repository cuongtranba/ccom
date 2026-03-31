# ccom — Claude Code Communication

[![npm](https://img.shields.io/npm/v/@tini-works/ccom)](https://www.npmjs.com/package/@tini-works/ccom)
[![Release @tini-works/ccom](https://github.com/cuongtranba/ccom/actions/workflows/release-node.yml/badge.svg?branch=main)](https://github.com/cuongtranba/ccom/actions/workflows/release-node.yml)

A real-time communication network for Claude Code instances. Each instance registers as a node on a shared WebSocket server. Nodes discover each other, exchange messages, and receive replies — directly inside their Claude sessions as channel events.

## How it works

- Each node connects to a central **WebSocket server** (Redis-backed, multi-instance)
- Nodes expose **3 MCP tools** so Claude can communicate with other nodes
- Incoming messages appear as `<channel source="ccom">` events in Claude's session
- Claude Code channels allow real-time push from the server into the active session

## MCP Tools

| Tool | Description |
|------|-------------|
| `ccom_ask` | Send a message to another node (or broadcast to all) |
| `ccom_reply` | Reply to an incoming message |
| `ccom_online_nodes` | List currently connected nodes |

## Prerequisites

- [Bun](https://bun.sh) 1.0+
- [Docker](https://docker.com) (for the central server)
- A Redis instance (included in docker-compose)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) v2.1.80+

## Install

### Option A: Published package (recommended)

```bash
bunx @tini-works/ccom init
# Follow the wizard — writes ccom-config.json + .mcp.json
```

### Option B: From source

Clone the repo and follow Quick Start below.

## Quick Start

### 1. Start the central server

```bash
docker-compose up -d
```

### 2. Create tokens for your nodes

Via the admin UI at `http://<server-host>:4400/admin`. Users can self-register without an admin key, or use the CLI:

```bash
bun run server token create --project my-project --node alice --name "Alice" --vertical dev --owner alice
bun run server token create --project my-project --node bob --name "Bob" --vertical design --owner bob
```

### 3. Set up your node

```bash
bunx @tini-works/ccom init
# Enter: server URL, auth token
# Node info is fetched from the server automatically
```

### 4. Start Claude Code with channels enabled

```bash
claude --dangerously-load-development-channels server:ccom
```

`server:ccom` refers to the MCP server named `"ccom"` in your `.mcp.json`:

```json
{
  "mcpServers": {
    "ccom": {
      "command": "bunx",
      "args": ["@tini-works/ccom@latest", "serve", "./ccom-config.json"]
    }
  }
}
```

Without this flag, Claude can still **send** messages via `ccom_ask`/`ccom_reply`, but **incoming** messages from other nodes won't appear in the session.

## Packages

- **`packages/shared`** — types + protocol (Envelope, MessagePayload)
- **`packages/node`** — local node client + MCP server (`@tini-works/ccom`)
- **`packages/server`** — central WebSocket hub (Redis-backed)
- **`packages/admin`** — admin React SPA (node management + signal flow)
- **`packages/dashboard`** — Astro SSR dashboard

## Development

```bash
bun test                    # full test suite
bun test packages/node      # node tests only
bun run server              # start central WebSocket server
bun run node serve          # start node MCP channel server
docker-compose up -d        # Redis + server
```

## Deployment

All deployments trigger on **push to `main`**. See `.github/workflows/` for CI details.
