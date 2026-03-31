# Signal Flow Admin Design
**Date:** 2026-03-30

## Goal
Add real-time node communication visibility to the admin panel:
1. Live log stream of routed messages (with payload content)
2. Real-time React Flow graph showing node topology and message signals
3. Peers sidebar embedded in the logs section

---

## Server Changes

### 1. Hub middleware hook (`packages/server/src/hub.ts`)
Add optional `onRoute` callback to `RedisHub`:
```ts
onRoute?: (envelope: Envelope) => void
```
Called inside `route()` before delivery. Keeps hub decoupled — just fires callback if registered.

### 2. SSE endpoint (`packages/server/src/index.ts`)
New `GET /api/stream` endpoint:
- Requires `Authorization: Bearer <adminKey>`
- Adds client to an in-memory `Set<SSEClient>` (each client is a Bun `Response` with a `ReadableStream`)
- Broadcasts two SSE event types:
  - `signal` — every routed envelope: `{ from, to, project, type, content (truncated 300 chars) }`
  - `log` — every new LogBuffer entry (piped via a `LogBuffer.onPush` hook)
- Cleans up on client disconnect

### 3. Message logging (`packages/server/src/index.ts`)
In the WS `message` handler, after `parseEnvelope`, log to LogBuffer:
```ts
log.info(`msg: ${envelope.payload.type}`, {
  from: envelope.fromNode,
  to: envelope.toNode ?? "",
  project: envelope.projectId,
  content: JSON.stringify(envelope.payload).slice(0, 300),
})
```

---

## Admin UI Changes

### 4. `useSignalStream` hook (`packages/admin/src/hooks/use-signal-stream.ts`)
- Opens `EventSource("/api/stream?key=<adminKey>")` when `adminKey` is present
- `signal` events → rolling deque, max 50, keyed by `from:to` with timestamp
- `log` events → prepend to live log list (replaces polling after initial load)
- Initial mount: one-time `GET /api/logs` for history, then SSE takes over
- Returns: `{ signals: SignalEdge[], logs: LogEntry[] }`
- Cleanup: `eventSource.close()` on unmount

### 5. React Flow `SignalFlow` component (`packages/admin/src/components/signal-flow.tsx`)
New full-width section between NodesTable and ServerLogs.

**Nodes:**
- One node per `ConnectedNode` from `/api/nodes` (polled 5s)
- Circular auto-layout (radius = `max(120, nodeCount * 60)`)
- Active node (signal in last 10s): spice-gold border + glow
- Custom node type with nodeId label + projects sub-label

**Edges:**
- Derived from `SignalEdge[]` deque
- Each unique `from→to` pair = one animated directed edge
- Recent (< 10s): spice-gold animated dashes
- Aging (10–30s): fade to muted via CSS `stroke-opacity` transition
- Expired (> 30s): removed from edge list
- Broadcast (to = ""): fan to all other known nodes
- Click node: highlight its edges; hover edge: tooltip with type + content

**Styling (Dune aesthetic):**
- Background: matches site background (`oklch(0.12 0.02 65)`)
- ReactFlow panel: no default controls styling, override with desert tokens
- Node: `bg-card border-border` → active: `border-primary shadow-[0_0_16px_oklch(0.72_0.16_55_/_0.4)]`
- Empty state: "No nodes in the spice network." center-aligned, muted

### 6. Enhanced `ServerLogs` (`packages/admin/src/components/server-logs.tsx`)
Split layout:
- Left 65%: log scroll area (existing + enhanced `msg:` entries)
- Right 35%: live peers mini-panel (replaces standalone `ConnectedNodes` section)

**Peers sidebar:**
- List of `ConnectedNode[]` (passed as prop)
- Green dot for nodes with signal in last 10s
- Node ID + projects + last message time

**Log entry rendering:**
- `msg:` entries: `[MSG]` badge in spice-gold, `from → to: type`, expandable content
- System entries: unchanged (info/warn/error badges)

### 7. `App.tsx` updates
- Remove `<ConnectedNodes>` section (merged into logs sidebar)
- Add `<SignalFlow>` section
- Replace `useLogs` polling with `useSignalStream` hook

---

## Package dependency
Add to `packages/admin/package.json`:
```json
"@xyflow/react": "^12"
```

---

## Data flow summary
```
Node WS message
  → hub.route(envelope)
    → onRoute(envelope) callback
      → SSE broadcast: "signal" event
  → log.info(...)
    → LogBuffer.onPush hook
      → SSE broadcast: "log" event

Admin EventSource
  → signal events → SignalEdge deque → React Flow edges
  → log events → LogEntry list → ServerLogs scroll area
```
