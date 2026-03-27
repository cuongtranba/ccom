# Channel Integration Design — Replace TUI + Agent SDK with Claude Code Channels

**Date:** 2026-03-27
**Status:** Validated
**Replaces:** Custom Chat TUI (`tui.ts`) + Claude Agent SDK (`agent.ts`)

## 1. Architecture Overview

Replace the custom TUI + Agent SDK with a single MCP channel server that integrates directly with Claude Code.

**Communication flow:**
```
Central Server <-> WebSocket <-> Channel Server (MCP) <-> stdio <-> Claude Code
```

**Single MCP server combines three capabilities:**
- **Channel** — receives WebSocket events from central server, pushes to Claude Code as `<channel>` tags
- **Tools** — exposes inventory actions (add item, verify, audit, etc.) as MCP tools
- **Permission relay** — forwards tool approval prompts to other team members via central server

**Startup flow:**
```
User runs: inv init
  -> wizard collects config
  -> writes inv-config.json + .mcp.json
  -> prints "Run: claude"

User runs: claude
  -> Claude Code reads .mcp.json
  -> starts channel server (MCP over stdio)
  -> channel server connects to central server via WebSocket
  -> ready to receive events + expose tools
```

**What gets removed:**
- `agent.ts` — Claude SDK wrapper (Claude Code replaces this entirely)
- `tui.ts` — readline Chat TUI (Claude Code IS the UI)
- `@anthropic-ai/sdk` dependency

**What gets added:**
- `channel.ts` — MCP channel server
- `cli.ts` — `inv init` wizard
- `@modelcontextprotocol/sdk` dependency

## 2. Channel Server — Internal Structure

The channel server (`packages/node/src/channel.ts`) bridges three worlds:

### MCP <-> Claude Code (stdio)
- Started by Claude Code as a subprocess (configured via `.mcp.json`)
- Communicates via `StdioServerTransport`
- Pushes network events as `<channel source="inventory">` notifications
- Receives tool calls from Claude (inventory actions + reply)

### WebSocket <-> Central Server
- Reuses existing `WSClient` from `ws-client.ts`
- Connects on startup, auto-reconnects
- Incoming messages -> parsed via `parseEnvelope()` -> routed to either:
  - **Engine** (state changes, signals, sweeps) — processed locally, then pushed to Claude as channel event
  - **Permission requests** — forwarded to Claude Code's permission system

### Engine (local processing)
- Reuses `Engine`, `Store`, `SignalPropagator` as-is
- All inventory logic stays unchanged
- Channel server just wires engine methods to MCP tools

### MCP Tools

| Tool | Maps to |
|------|---------|
| `inv_add_item` | `engine.addItem()` |
| `inv_add_trace` | `engine.addTrace()` |
| `inv_verify` | `engine.verifyItem()` |
| `inv_mark_broken` | `engine.markBroken()` |
| `inv_audit` | `engine.audit()` |
| `inv_ask` | `engine.ask()` -> broadcast via WSClient |
| `inv_reply` | **New** — sends reply envelope back through WSClient |

### Event Flow (inbound network message)

```
Central Server -> WebSocket -> WSClient
  -> ws-handlers.ts processes message
  -> engine updates local state
  -> eventBus emits event
  -> channel server listener pushes mcp.notification()
  -> Claude Code receives <channel source="inventory"> tag
  -> Claude decides what to do (may call tools, may ask user)
```

The key insight: `event-bus.ts` becomes the bridge. The channel server subscribes to all EventBus events and translates them to MCP channel notifications. No new event system needed.

## 3. Permission Relay

When Claude wants to use an inventory tool (e.g. `inv_mark_broken`), Claude Code shows an approval prompt. With permission relay, that prompt can be **forwarded to other team members** via the network.

**Use case:** Dev node marks an item as broken -> the PM node gets a permission request asking "Dev wants to mark item X broken. Allow?"

### Flow

```
Claude Code (Dev) -> approval needed for inv_mark_broken
  -> channel server receives permission_request notification
  -> wraps it in an Envelope (type: "permission_request")
  -> WSClient sends to central server
  -> central server routes to target node(s)

Target node (PM) channel server receives envelope
  -> pushes permission_request to PM's Claude Code
  -> PM's Claude (or human) decides: approve/deny
  -> channel server sends verdict back via WSClient
  -> central server routes verdict to Dev

Dev's channel server receives verdict
  -> pushes permission notification to Claude Code
  -> Claude Code proceeds or aborts the tool call
```

### New Types

```typescript
type ToolArgs =
  | { tool: "inv_add_item"; name: string; kind: ItemKind; vertical: Vertical; externalRef?: string }
  | { tool: "inv_add_trace"; fromItemId: string; toItemId: string; relation: TraceRelation }
  | { tool: "inv_verify"; itemId: string }
  | { tool: "inv_mark_broken"; itemId: string; reason?: string }
  | { tool: "inv_audit" }
  | { tool: "inv_ask"; question: string; targetNode?: string }
  | { tool: "inv_reply"; message: string; targetNode: string }
```

### New Message Types (added to `MessagePayload`)

```typescript
| { type: "permission_request"; requestId: string } & ToolArgs
| { type: "permission_verdict"; requestId: string; allowed: boolean; reason?: string }
```

### Routing

Permission requests use the existing `route()` method on RedisHub. The channel server decides who to ask based on `UPSTREAM_VERTICALS` from `shared/types.ts`.

### Fallback

If the target node is offline, the request stays local — Claude Code handles it with the normal human-in-the-loop prompt. No blocking on network.

## 4. `inv init` CLI Wizard

A single command that sets up everything needed to run a node with Claude Code.

**Entry point:** `packages/node/src/cli.ts` — called via `bun run node init`

### Interactive Flow

```
$ inv init

Inventory Node Setup
--------------------

Node name: dev-inventory
Vertical (pm/design/dev/qa/devops): dev
Project: clinic-checkin
Owner: cuong

Server URL: ws://lowbit.link:8080/ws
Auth token: ****

Database path (./inventory.db):

Writing inv-config.json... done
Writing .mcp.json... done

Setup complete! Start Claude Code:
  claude
```

### Files Written

`inv-config.json`:
```json
{
  "node": { "name": "dev-inventory", "vertical": "dev", "project": "clinic-checkin", "owner": "cuong" },
  "server": { "url": "ws://lowbit.link:8080/ws", "token": "..." },
  "database": { "path": "./inventory.db" }
}
```

`.mcp.json`:
```json
{
  "mcpServers": {
    "inventory": {
      "command": "bun",
      "args": ["run", "packages/node/src/channel.ts", "./inv-config.json"]
    }
  }
}
```

### Validation

Validates server URL format and tests token against server (quick WebSocket handshake) before writing files. If validation fails, asks again.

No other CLI commands. No `inv start`, no `inv status`. Everything else happens through Claude Code + MCP tools.

## 5. File Changes Summary

### Remove
- `packages/node/src/agent.ts` — Claude SDK wrapper (replaced by Claude Code)
- `packages/node/src/tui.ts` — readline Chat TUI (replaced by Claude Code)
- `@anthropic-ai/sdk` dependency

### Create
- `packages/node/src/channel.ts` — MCP channel server (channel + tools + permission relay + WebSocket bridge)
- `packages/node/src/cli.ts` — `inv init` wizard

### Modify
- `packages/node/src/index.ts` — replace current entry point with CLI router: `init` -> wizard, default -> channel server
- `packages/shared/src/types.ts` — add `ToolArgs` discriminated union
- `packages/shared/src/messages.ts` — add `permission_request` and `permission_verdict` to `MessagePayload`
- `packages/node/package.json` — swap `@anthropic-ai/sdk` for `@modelcontextprotocol/sdk`

### Unchanged
- `packages/shared/` (except types.ts, messages.ts)
- `packages/server/` (entire package)
- `packages/node/src/state.ts`
- `packages/node/src/store.ts`
- `packages/node/src/signal.ts`
- `packages/node/src/engine.ts`
- `packages/node/src/config.ts`
- `packages/node/src/event-bus.ts`
- `packages/node/src/ws-client.ts`
- `packages/node/src/ws-handlers.ts`

### Updated Monorepo Structure

```
packages/node/src/
├── channel.ts      <- NEW (MCP channel server)
├── cli.ts          <- NEW (inv init wizard)
├── index.ts        <- MODIFIED (CLI router only)
├── config.ts
├── engine.ts
├── event-bus.ts
├── signal.ts
├── state.ts
├── store.ts
├── ws-client.ts
└── ws-handlers.ts
```
