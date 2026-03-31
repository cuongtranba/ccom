# ccom — Claude Code Communication: Pivot Design

**Date:** 2026-03-31  
**Status:** Approved

## Overview

Pivot `inv` (Inventory Network) to `ccom` — a minimal, stateless real-time communication network for Claude Code instances. Remove all inventory concepts (SQLite store, state machines, signal propagation) and expose only 3 MCP tools for inter-node messaging.

## Goals

- Open-source friendly: no domain-specific inventory concepts
- Minimal: 3 tools instead of 16
- Stateless: no local SQLite, fire-and-forget messaging
- Renamed: `@tini-works/ccom`, tool prefix `ccom_`, config `ccom-config.json`

## MCP Tools (final set)

| Tool | Description |
|------|-------------|
| `ccom_ask` | Send an async message to another node |
| `ccom_reply` | Reply to an incoming message |
| `ccom_online_nodes` | List currently connected nodes |

Incoming messages appear in Claude's session as `<channel source="ccom">` tags.

## Files to Delete

- `packages/node/src/store.ts` — SQLite CRUD (1048 lines)
- `packages/node/src/state.ts` — item state machine
- `packages/node/src/signal.ts` — signal propagation

## Files to Rewrite

### `packages/node/src/engine.ts`
Currently 421 lines orchestrating store + state machines. Rewrite to ~50 lines:
- Wraps `WSClient` for send
- Exposes `ask(targetNode, message)` and `reply(messageId, message)`
- No state, no persistence

### `packages/node/src/channel.ts`
- Remove 13 tool definitions (all inventory + proposal + challenge + checklist)
- Keep and rename: `inv_ask` → `ccom_ask`, `inv_reply` → `ccom_reply`, `inv_online_nodes` → `ccom_online_nodes`
- Update channel source tag: `"inventory"` → `"ccom"`

### `packages/node/src/ws-handlers.ts`
- Remove all inventory-related message handlers
- Keep only: incoming `ask`/`reply` dispatch to Claude channel event

### `packages/shared/src/messages.ts`
- Remove all inventory payload types
- Keep only: ask, reply, online_nodes message types

## Files Unchanged

- `ws-client.ts` — WebSocket with reconnect logic
- `config.ts` — node identity + server URL (update config filename reference only)
- `cli.ts` — init/serve/update subcommands
- `packages/server/` — routing layer unchanged
- `packages/admin/` — signal flow UI unchanged

## Renames

| From | To |
|------|----|
| `@tini-works/inv-node` | `@tini-works/ccom` |
| MCP server name `"inventory"` | `"ccom"` |
| Tool prefix `inv_` | `ccom_` |
| `<channel source="inventory">` | `<channel source="ccom">` |
| `inv-config.json` | `ccom-config.json` |
| `inv-config.example.json` | `ccom-config.example.json` |

## CI/CD (`.github/workflows/release-node.yml`)

- `runs-on: self-hosted` → `runs-on: ubuntu-latest` (both `test` and `release` jobs)
- Remove: dead `prisma generate` step
- Rename: workflow name, tag prefix (`inv-node@*` → `ccom@*`), release name

## Landing Page (`web/`)

New narrative: "Real-time communication network for Claude Code instances"

- **Hero**: "Claude Code doesn't work alone anymore."
- **Section 1**: How nodes discover each other
- **Section 2**: `ccom_ask` / `ccom_reply` — messages appear in Claude's session
- **Section 3**: Get started (3 steps)

Remove: `StateMachine`, `CrossTeamCascade`, `GovernanceLifecycle` demo components  
Update: `ClaudeCodeDemo` with new copy

## README & Docs

- **README.md**: Full rewrite — new package name, 3 tools, updated install/setup steps
- **CLAUDE.md**: Update architecture section, remove inventory concepts, simplify message flow diagram
- **`ccom-config.example.json`**: Renamed from `inv-config.example.json`
