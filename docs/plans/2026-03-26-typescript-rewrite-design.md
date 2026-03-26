# TypeScript Rewrite — WebSocket + Central Server + Chat TUI

**Date:** 2026-03-26
**Status:** Approved
**Motivation:** Reduce complexity by replacing libp2p P2P with a central WebSocket server, and unify the stack in TypeScript/Bun with Claude Agent SDK integration.

## Decision Summary

| Decision | Choice |
|---|---|
| Why change | libp2p is too complex for what we need |
| Transport | WebSocket (bidirectional, simple) |
| Server responsibility | Routing + presence + outbox for offline nodes |
| Auth | Simple project-scoped tokens |
| Multi-instance | Redis-backed from day one |
| Deployment | Self-hosted on Dokploy/lowbit.link |
| AI integration | Claude Agent SDK (TypeScript) built into node |
| Human-in-loop | Configurable autonomy — auto vs approval per message type |
| User interface | Chat TUI (like Claude Code) with live events + slash commands |
| MCP | Removed — TUI + Agent SDK replaces external AI tool integration |
| Language | Full TypeScript/Bun — Go code retired |
| Runtime | Bun (native WebSocket, native SQLite, fast) |
| Migration | Clean break — fresh rewrite, not incremental port |

## Architecture

```
┌─────────────────────────────────────────────────┐
│          Central Server (Bun/TypeScript)          │
│  Redis-backed hub, WebSocket routing, outbox      │
│  Deployed on Dokploy/lowbit.link                  │
└──────────────┬──────────────────┬─────────────────┘
               │ WebSocket        │ WebSocket
               ▼                  ▼
┌──────────────────────┐  ┌──────────────────────┐
│   Node A (Bun)       │  │   Node B (Bun)       │
│                      │  │                      │
│  Chat TUI            │  │  Chat TUI            │
│  Claude Agent SDK    │  │  Claude Agent SDK    │
│  Engine + Store      │  │  Engine + Store      │
│  SQLite (bun:sqlite) │  │  SQLite (bun:sqlite) │
│  WebSocket client    │  │  WebSocket client    │
└──────────────────────┘  └──────────────────────┘
```

## Central Server (`packages/server`)

### Hub — Redis-backed

```typescript
interface Hub {
  register(projectId: string, nodeId: string, ws: WebSocket): void;
  unregister(projectId: string, nodeId: string): void;
  route(envelope: Envelope): Promise<void>;
  isOnline(projectId: string, nodeId: string): Promise<boolean>;
}
```

**Presence** — Redis hash:
```
Key: "presence:{projectId}" → Hash { nodeId: instanceId }
```
- `HSET` on connect, `HDEL` on disconnect
- `HGETALL` to list online nodes

**Message routing** — Redis Pub/Sub:
```
Channel: "route:{projectId}"
```
- Destination online on this instance → deliver directly
- Destination on another instance → publish to channel
- Destination offline → push to outbox

**Outbox** — Redis list:
```
Key: "outbox:{projectId}:{nodeId}" → List of serialized Envelopes
```
- `RPUSH` to queue, `LPOP` to drain on reconnect

**Token storage** — Redis hash:
```
Key: "token:{token}" → Hash { projectId, nodeId, createdAt }
```

### WebSocket Endpoint

1. Node connects to `ws://<server>/ws?token=<token>`
2. Server validates token → extracts projectId + nodeId
3. Registers in hub presence map
4. Drains outbox to node
5. Enters message loop — routes incoming Envelopes
6. On disconnect — removes from presence

### Server CLI

```bash
bun run server start --port 8080 --redis redis://localhost:6379
bun run server token create --project clinic-checkin --node dev-inventory
bun run server token list --project clinic-checkin
bun run server token revoke <token>
```

## Node (`packages/node`)

### Engine

Ported from Go. Core domain logic:

- **engine.ts** — RegisterNode, AddItem, AddTrace, VerifyItem, MarkBroken, PropagateChange, Impact, Audit, Ask
- **store.ts** — SQLite persistence via `bun:sqlite`. Nodes, items, traces, pending actions
- **state.ts** — Item lifecycle state machine: unverified → proven → suspect → broke
- **signal.ts** — Change propagation through trace graph

### WebSocket Client (`ws-client.ts`)

```typescript
interface WSClient {
  connect(): Promise<void>;
  send(envelope: Envelope): void;
  broadcast(envelope: Envelope): void;
  onMessage(handler: (envelope: Envelope) => void): void;
  close(): void;
}
```

- Single WebSocket connection to central server
- Auto-reconnect with exponential backoff (1s, 2s, 4s... max 30s)
- No local outbox — server handles offline queuing

### Message Handlers (`ws-handlers.ts`)

Same dispatch logic as current Go `p2p_handlers.go`:
- Receives deserialized Envelope
- Switches on message type
- Calls engine methods
- Fires events on event bus

### Event Bus (`event-bus.ts`)

```typescript
type EventType =
  | "signal_change"
  | "sweep"
  | "trace_resolve"
  | "query_ask"
  | "query_respond";

interface EventBus {
  on(event: EventType, handler: (data: unknown) => void): void;
  emit(event: EventType, data: unknown): void;
}
```

### Chat TUI (`tui.ts`)

Persistent terminal chat interface powered by Claude Agent SDK:

- Live event stream — incoming network events appear in chat
- Slash commands: `/status`, `/ask`, `/approve`, `/reject`, `/pending`
- Claude reasons about events, proposes actions
- Natural language interaction for everything else

**Example session:**
```
$ inv chat

🟢 Connected to clinic-checkin (dev-inventory)
   3 peers online: pm-inventory, qa-inventory, design-inventory

> /status
  12 items, 8 verified, 2 suspect, 2 unverified

  ── incoming event ──────────────────────────
  📨 PM changed "Check-in API v2" → your ADR is now suspect
  Claude: I can re-verify this with the latest load test. Want me to proceed?
  ──────────────────────────────────────────────

> yes
  ✓ Re-verified ADR "WebSocket for real-time updates"

> /ask pm "What's the timeline for the check-in API migration?"
  📤 Query sent to pm-inventory

  ── incoming response ───────────────────────
  💬 PM (duke): Targeting end of sprint 12 (2026-04-03)
  ──────────────────────────────────────────────
```

### Autonomy Config

```yaml
node:
  id: "dev-inventory"
  project: "clinic-checkin"

server:
  url: "ws://lowbit.link:8080/ws"
  token: "abc123"

autonomy:
  auto:
    - signal_change
    - trace_resolve
    - sweep
    - query_respond
  approval:
    - proposal_vote
    - challenge_respond
    - pair_invite
    - cr_create
```

**Auto** — Claude handles without asking. Calls engine methods directly.

**Approval** — Claude analyzes, proposes action, queues for human:
```sql
CREATE TABLE pending_actions (
  id           TEXT PRIMARY KEY,
  message_type TEXT NOT NULL,
  envelope     TEXT NOT NULL,
  summary      TEXT NOT NULL,
  proposed     TEXT NOT NULL,
  status       TEXT DEFAULT 'pending',
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP
);
```

## Shared Types (`packages/shared`)

### Message Types (`messages.ts`)

Replace protobuf with TypeScript types + JSON serialization:

```typescript
interface Envelope {
  messageId: string;
  fromNode: string;
  toNode: string;       // empty = broadcast
  projectId: string;
  timestamp: string;
  payload: MessagePayload;
}

type MessagePayload =
  | { type: "signal_change"; itemId: string; oldState: string; newState: string }
  | { type: "sweep"; externalRef: string; newValue: string }
  | { type: "trace_resolve_request"; itemId: string }
  | { type: "trace_resolve_response"; itemId: string; title: string; kind: string; state: string }
  | { type: "query_ask"; question: string; askerId: string }
  | { type: "query_respond"; answer: string; responderId: string }
  | { type: "ack"; originalMessageId: string }
  | { type: "error"; code: string; message: string };
```

### Domain Types (`types.ts`)

```typescript
type Vertical = "pm" | "design" | "dev" | "qa" | "devops";

type ItemState = "unverified" | "proven" | "suspect" | "broke";

interface Node {
  id: string;
  name: string;
  vertical: Vertical;
  project: string;
  owner: string;
  isAI: boolean;
  createdAt: string;
}

interface Item {
  id: string;
  nodeId: string;
  kind: string;
  title: string;
  state: ItemState;
  body: string;
  externalRef: string;
  createdAt: string;
  updatedAt: string;
}

interface Trace {
  id: string;
  fromItem: string;
  toItem: string;
  relation: "traced_from" | "depends_on" | "validated_by";
  actor: string;
  createdAt: string;
}
```

## Monorepo Structure

```
my-inventory/
├── packages/
│   ├── server/
│   │   ├── src/
│   │   │   ├── hub.ts          # Redis-backed connection registry + routing
│   │   │   ├── outbox.ts       # Redis outbox for offline nodes
│   │   │   ├── auth.ts         # Token validation + management
│   │   │   └── index.ts        # Server entry point, WebSocket upgrade
│   │   ├── test/
│   │   │   └── server.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── node/
│   │   ├── src/
│   │   │   ├── engine.ts       # Core domain logic
│   │   │   ├── store.ts        # SQLite persistence (bun:sqlite)
│   │   │   ├── state.ts        # Item lifecycle state machine
│   │   │   ├── signal.ts       # Change propagation through traces
│   │   │   ├── ws-client.ts    # WebSocket connection + reconnect
│   │   │   ├── ws-handlers.ts  # Message dispatch to engine
│   │   │   ├── event-bus.ts    # Event pub/sub
│   │   │   ├── tui.ts          # Chat TUI with Agent SDK
│   │   │   └── index.ts        # Node entry point
│   │   ├── test/
│   │   │   ├── engine.test.ts
│   │   │   ├── store.test.ts
│   │   │   ├── state.test.ts
│   │   │   └── signal.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── shared/
│       ├── src/
│       │   ├── types.ts        # Domain types (Node, Item, Trace, etc.)
│       │   └── messages.ts     # Envelope + message payload types
│       ├── package.json
│       └── tsconfig.json
├── package.json                # Workspace root
├── bunfig.toml
└── tsconfig.json
```

## V1 Scope

**Included:**
- Engine: nodes, items, traces, state machine, signal propagation
- Store: SQLite with bun:sqlite
- Central server: WebSocket + Redis hub/outbox/auth
- Chat TUI: Agent SDK, live events, basic slash commands
- Autonomy config: auto vs approval message handling

**Deferred to V2:**
- Proposals/voting system
- Challenge system
- Pairing sessions
- Checklist feature
- Observability/metrics
- Kind mapping

## What Gets Removed (Go)

All Go source files, go.mod, go.sum, proto/, relay/, and the compiled binaries. The Go code serves as reference during the TypeScript port but is not kept in the final codebase.
