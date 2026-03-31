# Signal Flow Admin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add real-time node communication visibility to the admin panel — SSE-based live log stream, React Flow topology graph with animated signal edges, and a peers sidebar in the logs section.

**Architecture:** A middleware hook on `RedisHub.route()` + a `LogBuffer.onPush` hook both funnel events to an SSE broadcast set in `index.ts`. The admin opens an `EventSource` on `/api/stream?key=<adminKey>`, receives `signal` and `log` events, and feeds them into a React Flow graph (`SignalFlow`) and a live log list (`ServerLogs`).

**Tech Stack:** Bun SSE (ReadableStream), `@xyflow/react` v12, React 19, TanStack Query v5, Tailwind v4 (OKLCH tokens), TypeScript strict

**Worktree:** `.worktrees/signal-flow-admin` on branch `feature/signal-flow-admin`

---

## Task 1: LogBuffer — add onPush callback

**Files:**
- Modify: `packages/server/src/log-buffer.ts`
- Test: `packages/server/test/log-buffer.test.ts`

**Step 1: Write the failing test**

Create `packages/server/test/log-buffer.test.ts`:
```ts
import { describe, test, expect } from "bun:test";
import { LogBuffer } from "../src/log-buffer";
import type { LogEntry } from "../src/log-buffer";

describe("LogBuffer", () => {
  test("setOnPush callback fires on every push", () => {
    const buf = new LogBuffer(10);
    const captured: LogEntry[] = [];
    buf.setOnPush((entry) => captured.push(entry));

    buf.info("hello", { key: "val" });
    buf.warn("caution");
    buf.error("boom");

    expect(captured).toHaveLength(3);
    expect(captured[0].level).toBe("info");
    expect(captured[0].message).toBe("hello");
    expect(captured[0].meta).toEqual({ key: "val" });
    expect(captured[1].level).toBe("warn");
    expect(captured[2].level).toBe("error");
  });

  test("setOnPush not called when not set", () => {
    const buf = new LogBuffer(10);
    // Should not throw
    buf.info("no callback");
    expect(buf.entries()).toHaveLength(1);
  });

  test("setOnPush can be replaced", () => {
    const buf = new LogBuffer(10);
    const calls: string[] = [];
    buf.setOnPush((e) => calls.push("first:" + e.message));
    buf.info("one");
    buf.setOnPush((e) => calls.push("second:" + e.message));
    buf.info("two");
    expect(calls).toEqual(["first:one", "second:two"]);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test packages/server/test/log-buffer.test.ts
```
Expected: FAIL — `buf.setOnPush is not a function`

**Step 3: Implement in log-buffer.ts**

Add `private pushCallback?: (entry: LogEntry) => void` field and `setOnPush` method. Call `this.pushCallback?.(entry)` at the end of `push()`:

```ts
export class LogBuffer {
  private buffer: LogEntry[] = [];
  private maxSize: number;
  private pushCallback?: (entry: LogEntry) => void;   // ← add

  constructor(maxSize = 200) {
    this.maxSize = maxSize;
  }

  setOnPush(fn: (entry: LogEntry) => void): void {    // ← add
    this.pushCallback = fn;
  }

  push(level: LogEntry["level"], message: string, meta?: Record<string, string>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      meta,
    };
    this.buffer.push(entry);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
    this.pushCallback?.(entry);                        // ← add
  }

  // ... rest unchanged
}
```

**Step 4: Run test to verify it passes**

```bash
bun test packages/server/test/log-buffer.test.ts
```
Expected: 3 tests pass

**Step 5: Commit**

```bash
git add packages/server/src/log-buffer.ts packages/server/test/log-buffer.test.ts
git commit -m "feat(server): add onPush callback to LogBuffer"
```

---

## Task 2: RedisHub — add onRoute callback

**Files:**
- Modify: `packages/server/src/hub.ts`

No new test possible without a live Redis. The callback is a single optional property — verified by integration once SSE is wired up.

**Step 1: Add `onRoute` to RedisHub**

In `hub.ts`, add a public property and call it inside `route()`:

```ts
// After the class field declarations, add:
onRoute?: (envelope: Envelope) => void;
```

In the `route()` method, add as the very first line:
```ts
async route(envelope: Envelope): Promise<void> {
  this.onRoute?.(envelope);   // ← add this line first
  // ... existing code unchanged
}
```

The import for `Envelope` is already present via `@inv/shared`.

**Step 2: Commit**

```bash
git add packages/server/src/hub.ts
git commit -m "feat(server): add onRoute callback hook to RedisHub"
```

---

## Task 3: SSE endpoint + message logging in index.ts

**Files:**
- Modify: `packages/server/src/index.ts`

No unit test — SSE requires a live HTTP server. Verified manually once admin is connected.

**Step 1: Add SSE client types and broadcast set**

Near the top of `startServer()`, after `const log = new LogBuffer(200);`, add:

```ts
// ── SSE broadcast ────────────────────────────────────────────────────────────
interface SSEClient {
  write: (data: string) => void;
  close: () => void;
}
const sseClients = new Set<SSEClient>();

function broadcastSSE(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}
```

**Step 2: Wire LogBuffer and Hub to SSE**

After `log.info("Server started", ...)`, add:

```ts
log.setOnPush((entry) => broadcastSSE("log", entry));

hub.onRoute = (envelope) => {
  broadcastSSE("signal", {
    from: envelope.fromNode,
    to: envelope.toNode,
    project: envelope.projectId,
    type: envelope.payload.type,
    content: JSON.stringify(envelope.payload).slice(0, 300),
    timestamp: new Date().toISOString(),
  });
};
```

**Step 3: Add message logging in WS handler**

In the `websocket.message` handler, after `envelope.fromNode = ws.data.nodeId;` and before `await hub.route(envelope);`, add:

```ts
log.info(`msg: ${envelope.payload.type}`, {
  from: envelope.fromNode,
  to: envelope.toNode ?? "",
  project: envelope.projectId,
  content: JSON.stringify(envelope.payload).slice(0, 300),
});
```

**Step 4: Add /api/stream SSE endpoint**

Add this route block in the `fetch` handler, after the `/api/logs` block (before the node/project removal block):

```ts
if (url.pathname === "/api/stream" && req.method === "GET") {
  // Accept key via query param (EventSource doesn't support headers)
  const key = url.searchParams.get("key") ?? "";
  if (!adminKey || key !== adminKey) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let clientController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      clientController = controller;
      // Send initial heartbeat
      controller.enqueue(encoder.encode(": connected\n\n"));
    },
    cancel() {
      sseClients.delete(client);
    },
  });

  const client: SSEClient = {
    write(data: string) {
      try {
        clientController?.enqueue(encoder.encode(data));
      } catch {
        sseClients.delete(client);
      }
    },
    close() {
      try { clientController?.close(); } catch { /* ignore */ }
      sseClients.delete(client);
    },
  };

  sseClients.add(client);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
```

**Step 5: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): add SSE /api/stream endpoint with signal+log broadcast"
```

---

## Task 4: Install @xyflow/react in admin

**Files:**
- Modify: `packages/admin/package.json`

**Step 1: Add dependency**

In `packages/admin/package.json`, add to `dependencies`:
```json
"@xyflow/react": "^12.3.6"
```

**Step 2: Install**

```bash
cd packages/admin && pnpm install
```

**Step 3: Commit**

```bash
git add packages/admin/package.json packages/admin/pnpm-lock.yaml
git commit -m "feat(admin): add @xyflow/react dependency"
```

---

## Task 5: Add SignalEvent type and fetchStream helper to api.ts

**Files:**
- Modify: `packages/admin/src/lib/api.ts`

**Step 1: Add SignalEvent type**

After the `LogEntry` interface, add:

```ts
export interface SignalEvent {
  from: string;
  to: string;
  project: string;
  type: string;
  content: string;
  timestamp: string;
}
```

**Step 2: Commit**

```bash
git add packages/admin/src/lib/api.ts
git commit -m "feat(admin): add SignalEvent type to api.ts"
```

---

## Task 6: useSignalStream hook

**Files:**
- Create: `packages/admin/src/hooks/use-signal-stream.ts`

**Step 1: Create the hook**

```ts
import { useState, useEffect } from "react";
import type { LogEntry, SignalEvent } from "@/lib/api";
import { fetchLogs } from "@/lib/api";

const MAX_SIGNALS = 50;
const MAX_LOGS = 200;

export function useSignalStream(adminKey: string) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [signals, setSignals] = useState<SignalEvent[]>([]);

  // Load initial log history once
  useEffect(() => {
    if (!adminKey) return;
    fetchLogs(adminKey).then(setLogs).catch(() => {});
  }, [adminKey]);

  // Open SSE stream
  useEffect(() => {
    if (!adminKey) return;

    const es = new EventSource(
      `/api/stream?key=${encodeURIComponent(adminKey)}`,
    );

    es.addEventListener("signal", (e: MessageEvent) => {
      const data = JSON.parse(e.data) as SignalEvent;
      setSignals((prev) => {
        // Replace existing entry for same from→to pair, keep rolling max
        const filtered = prev.filter(
          (s) => !(s.from === data.from && s.to === data.to),
        );
        return [data, ...filtered].slice(0, MAX_SIGNALS);
      });
    });

    es.addEventListener("log", (e: MessageEvent) => {
      const entry = JSON.parse(e.data) as LogEntry;
      setLogs((prev) => [...prev, entry].slice(-MAX_LOGS));
    });

    es.onerror = () => {
      // EventSource auto-reconnects — no manual handling needed
    };

    return () => es.close();
  }, [adminKey]);

  return { logs, signals };
}
```

**Step 2: Commit**

```bash
git add packages/admin/src/hooks/use-signal-stream.ts
git commit -m "feat(admin): add useSignalStream SSE hook"
```

---

## Task 7: SignalFlow React Flow component

**Files:**
- Create: `packages/admin/src/components/signal-flow.tsx`

**Step 1: Create the component**

```tsx
import { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type NodeProps,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ConnectedNode, SignalEvent } from "@/lib/api";

// ── Desert node component ────────────────────────────────────────────────────

interface DesertNodeData {
  nodeId: string;
  projects: string[];
  isActive: boolean;
  [key: string]: unknown;
}

function DesertNode({ data, selected }: NodeProps) {
  const d = data as DesertNodeData;
  return (
    <div
      style={{
        background: "oklch(0.16 0.025 65)",
        border: `1px solid ${d.isActive ? "oklch(0.72 0.16 55)" : "oklch(0.28 0.04 65)"}`,
        borderRadius: "0.25rem",
        padding: "10px 14px",
        minWidth: 120,
        boxShadow: d.isActive
          ? "0 0 16px oklch(0.72 0.16 55 / 0.35)"
          : selected
            ? "0 0 12px oklch(0.72 0.16 55 / 0.2)"
            : "none",
        transition: "border-color 0.4s, box-shadow 0.4s",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: "oklch(0.72 0.16 55)", border: "none", width: 6, height: 6 }}
      />
      <div
        style={{
          fontFamily: "Space Grotesk, sans-serif",
          fontSize: "0.7rem",
          fontWeight: 700,
          color: d.isActive ? "oklch(0.82 0.18 55)" : "oklch(0.82 0.04 70)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {d.nodeId}
      </div>
      <div
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: "0.6rem",
          color: "oklch(0.55 0.03 65)",
          marginTop: 2,
        }}
      >
        {d.projects.join(", ")}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: "oklch(0.72 0.16 55)", border: "none", width: 6, height: 6 }}
      />
    </div>
  );
}

const nodeTypes = { desertNode: DesertNode };

// ── Layout helpers ───────────────────────────────────────────────────────────

function circularLayout(connectedNodes: ConnectedNode[]): Node[] {
  const n = connectedNodes.length;
  if (n === 0) return [];
  const cx = 400;
  const cy = 180;
  const r = Math.max(130, n * 65);
  return connectedNodes.map((node, i) => ({
    id: node.nodeId,
    type: "desertNode",
    position: {
      x: cx + r * Math.cos((2 * Math.PI * i) / n - Math.PI / 2) - 60,
      y: cy + r * Math.sin((2 * Math.PI * i) / n - Math.PI / 2) - 25,
    },
    data: {
      nodeId: node.nodeId,
      projects: node.projects,
      isActive: false,
    },
  }));
}

function deriveEdges(
  signals: SignalEvent[],
  connectedNodes: ConnectedNode[],
  selectedNode: string | null,
): Edge[] {
  const now = Date.now();
  const nodeIds = new Set(connectedNodes.map((n) => n.nodeId));

  // Deduplicate: keep most-recent signal per from→to pair
  const seen = new Map<string, SignalEvent>();
  for (const s of signals) {
    const key = `${s.from}:${s.to}`;
    if (!seen.has(key)) seen.set(key, s);
  }

  const edges: Edge[] = [];
  for (const [, s] of seen) {
    const age = now - new Date(s.timestamp).getTime();
    if (age > 30_000) continue;

    const isRecent = age < 10_000;
    const opacity = isRecent ? 1 : Math.max(0, 1 - (age - 10_000) / 20_000);
    const color = isRecent ? "oklch(0.72 0.16 55)" : "oklch(0.55 0.03 65)";

    const makeEdge = (from: string, to: string): Edge => ({
      id: `${from}:${to}`,
      source: from,
      target: to,
      animated: isRecent,
      style: { stroke: color, strokeOpacity: opacity, strokeWidth: 1.5 },
      label: s.type,
      labelStyle: {
        fill: "oklch(0.55 0.03 65)",
        fontSize: 9,
        fontFamily: "JetBrains Mono, monospace",
      },
      labelBgStyle: { fill: "oklch(0.16 0.025 65)", fillOpacity: 0.85 },
      data: { type: s.type, content: s.content },
    });

    if (s.to === "") {
      // Broadcast — fan to all known nodes except sender
      for (const n of connectedNodes) {
        if (n.nodeId !== s.from && nodeIds.has(n.nodeId)) {
          edges.push(makeEdge(s.from, n.nodeId));
        }
      }
    } else if (nodeIds.has(s.from) && nodeIds.has(s.to)) {
      edges.push(makeEdge(s.from, s.to));
    }
  }

  if (selectedNode) {
    return edges.filter(
      (e) => e.source === selectedNode || e.target === selectedNode,
    );
  }
  return edges;
}

// ── Main component ───────────────────────────────────────────────────────────

interface SignalFlowProps {
  connectedNodes: ConnectedNode[];
  signals: SignalEvent[];
  isAuthed: boolean;
}

export function SignalFlow({ connectedNodes, signals, isAuthed }: SignalFlowProps) {
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // Rebuild nodes on connected set change
  useEffect(() => {
    const now = Date.now();
    const activeNodes = new Set(
      signals
        .filter((s) => now - new Date(s.timestamp).getTime() < 10_000)
        .flatMap((s) => [s.from, s.to].filter(Boolean)),
    );

    setRfNodes(
      circularLayout(connectedNodes).map((n) => ({
        ...n,
        data: {
          ...n.data,
          isActive: activeNodes.has(n.id),
        },
      })),
    );
  }, [connectedNodes, signals]);

  // Re-derive edges on every signal update (runs frequently via SSE)
  useEffect(() => {
    setRfEdges(deriveEdges(signals, connectedNodes, selectedNode));
  }, [signals, connectedNodes, selectedNode]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedNode((prev) => (prev === node.id ? null : node.id));
    },
    [],
  );

  if (!isAuthed) return null;

  return (
    <section className="mb-10">
      <div className="mb-5 border-b border-sand-dim pb-2 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-accent">
        Signal Flow
      </div>

      {connectedNodes.length === 0 ? (
        <div
          style={{
            height: 220,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "oklch(0.16 0.025 65)",
            borderRadius: "0.25rem",
            color: "oklch(0.55 0.03 65)",
            fontFamily: "Space Grotesk, sans-serif",
            fontSize: "0.75rem",
            letterSpacing: "0.1em",
          }}
        >
          No nodes in the spice network.
        </div>
      ) : (
        <div style={{ height: 400, borderRadius: "0.25rem", overflow: "hidden" }}>
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            proOptions={{ hideAttribution: true }}
            style={{ background: "oklch(0.13 0.02 65)" }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="oklch(0.28 0.04 65)"
            />
          </ReactFlow>
        </div>
      )}
    </section>
  );
}
```

**Step 2: Commit**

```bash
git add packages/admin/src/components/signal-flow.tsx
git commit -m "feat(admin): add SignalFlow React Flow component with Dune aesthetic"
```

---

## Task 8: Enhanced ServerLogs with peers sidebar

**Files:**
- Modify: `packages/admin/src/components/server-logs.tsx`

**Step 1: Rewrite the component**

Replace the entire file content:

```tsx
import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LogEntry, ConnectedNode, SignalEvent } from "@/lib/api";

interface ServerLogsProps {
  logs: LogEntry[];
  signals: SignalEvent[];
  connectedNodes: ConnectedNode[];
  isAuthed: boolean;
}

const LEVEL_STYLES: Record<string, string> = {
  info: "bg-primary/20 text-primary",
  warn: "bg-accent/20 text-accent",
  error: "bg-destructive/20 text-destructive",
};

function isMsgEntry(entry: LogEntry): boolean {
  return entry.message.startsWith("msg: ");
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function LogLine({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const isMsg = isMsgEntry(entry);

  if (isMsg) {
    const from = entry.meta?.from ?? "";
    const to = entry.meta?.to ?? "";
    const type = entry.message.replace("msg: ", "");
    const content = entry.meta?.content ?? "";

    return (
      <div className="py-0.5">
        <div
          className="flex cursor-pointer gap-3"
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="shrink-0 text-muted-foreground">
            {new Date(entry.timestamp).toLocaleTimeString("en-US", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
          <Badge className="h-4 shrink-0 rounded px-1.5 text-[0.6rem] font-medium uppercase bg-primary/20 text-primary">
            msg
          </Badge>
          <span className="text-foreground">
            <span style={{ color: "oklch(0.72 0.16 55)" }}>{from}</span>
            <span className="text-muted-foreground"> → </span>
            <span style={{ color: "oklch(0.78 0.14 85)" }}>{to || "*"}</span>
            <span className="ml-2 text-muted-foreground">{type}</span>
          </span>
        </div>
        {expanded && content && (
          <div className="ml-[6.5rem] mt-0.5 rounded bg-muted p-1.5 text-[0.6rem] text-muted-foreground break-all">
            {content}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-3 py-0.5">
      <span className="shrink-0 text-muted-foreground">
        {new Date(entry.timestamp).toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
      </span>
      <Badge
        className={cn(
          "h-4 shrink-0 rounded px-1.5 text-[0.6rem] font-medium uppercase",
          LEVEL_STYLES[entry.level] ?? "",
        )}
      >
        {entry.level}
      </Badge>
      <span className="text-foreground">{entry.message}</span>
      {entry.meta && !isMsgEntry(entry) && (
        <span className="text-muted-foreground">
          {Object.entries(entry.meta)
            .filter(([k]) => !["from", "to", "project", "content"].includes(k))
            .map(([k, v]) => `${k}=${v}`)
            .join(" ")}
        </span>
      )}
    </div>
  );
}

export function ServerLogs({
  logs,
  signals,
  connectedNodes,
  isAuthed,
}: ServerLogsProps) {
  const disabled = !isAuthed;
  const [paused, setPaused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const now = Date.now();

  const activeNodeIds = new Set(
    signals
      .filter((s) => now - new Date(s.timestamp).getTime() < 10_000)
      .flatMap((s) => [s.from, s.to].filter(Boolean)),
  );

  useEffect(() => {
    if (!paused && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, paused]);

  return (
    <section className="mb-12">
      <div className="mb-5 flex items-center justify-between border-b border-sand-dim pb-2">
        <div className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-accent">
          Server Logs
        </div>
        {!disabled && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPaused(!paused)}
            className="h-6 border-border px-2 text-[0.65rem] uppercase tracking-wider"
          >
            {paused ? "Resume" : "Pause"}
          </Button>
        )}
      </div>

      {disabled ? (
        <div className="bg-card p-8 text-sm text-muted-foreground">
          Authenticate to view server logs.
        </div>
      ) : (
        <div className="flex gap-4">
          {/* Log stream — 65% */}
          <div className="min-w-0 flex-[65]">
            {logs.length === 0 ? (
              <div className="bg-card p-8 text-sm text-muted-foreground">
                No log entries yet.
              </div>
            ) : (
              <ScrollArea className="h-[300px] bg-card">
                <div className="p-4 font-mono text-xs">
                  {logs.map((entry, i) => (
                    <LogLine key={i} entry={entry} />
                  ))}
                  <div ref={bottomRef} />
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Peers sidebar — 35% */}
          <div className="flex-[35]">
            <div className="mb-2 text-[0.6rem] font-semibold uppercase tracking-widest text-muted-foreground">
              Live Peers
            </div>
            {connectedNodes.length === 0 ? (
              <div className="bg-card p-4 text-[0.7rem] text-muted-foreground">
                No nodes connected.
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {connectedNodes.map((node) => {
                  const isActive = activeNodeIds.has(node.nodeId);
                  return (
                    <div
                      key={node.nodeId}
                      className="flex items-start gap-2 rounded bg-card px-3 py-2"
                    >
                      <span
                        className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
                        style={{
                          background: isActive
                            ? "oklch(0.65 0.14 145)"
                            : "oklch(0.38 0.05 65)",
                          boxShadow: isActive
                            ? "0 0 6px oklch(0.65 0.14 145 / 0.6)"
                            : "none",
                          transition: "background 0.4s, box-shadow 0.4s",
                        }}
                      />
                      <div className="min-w-0">
                        <div className="truncate font-mono text-[0.65rem] font-semibold text-foreground">
                          {node.nodeId}
                        </div>
                        <div className="text-[0.58rem] text-muted-foreground">
                          {node.projects.join(", ")}
                        </div>
                        <div className="text-[0.58rem] text-muted-foreground">
                          {node.lastMessageAt
                            ? formatRelative(node.lastMessageAt)
                            : "no messages"}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
```

**Step 2: Commit**

```bash
git add packages/admin/src/components/server-logs.tsx
git commit -m "feat(admin): enhance ServerLogs with msg entries and peers sidebar"
```

---

## Task 9: Wire everything in App.tsx

**Files:**
- Modify: `packages/admin/src/App.tsx`

**Step 1: Update App.tsx**

Replace the entire file:

```tsx
import { useAuth } from "@/hooks/use-auth";
import { AuthGate } from "@/components/auth-gate";
import { MetricsStrip } from "@/components/metrics-strip";
import { ServerLogs } from "@/components/server-logs";
import { RegisterForm } from "@/components/register-form";
import { ProjectsTable } from "@/components/projects-table";
import { NodesTable } from "@/components/nodes-table";
import { SignalFlow } from "@/components/signal-flow";
import { useMetrics, useNodes } from "@/hooks/queries";
import { useSignalStream } from "@/hooks/use-signal-stream";

export default function App() {
  const { adminKey, setAdminKey, isAuthed } = useAuth();
  const metrics = useMetrics(isAuthed);
  const nodes = useNodes(adminKey);
  const { logs, signals } = useSignalStream(isAuthed ? adminKey : "");

  return (
    <div className="mx-auto max-w-[960px] px-[clamp(1rem,3vw,2rem)] py-8 font-sans">
      <header className="mb-8 text-center">
        <h1 className="font-sans text-[clamp(1.2rem,3vw,1.6rem)] font-bold tracking-tight text-foreground">
          Spacing Guild Console
        </h1>
        <p className="text-xs text-muted-foreground">inventory network control</p>
      </header>

      <AuthGate adminKey={adminKey} onKeyChange={setAdminKey} isAuthed={isAuthed} />

      {!isAuthed ? (
        <RegisterForm />
      ) : (
        <>
          <MetricsStrip metrics={metrics.data} changedFields={metrics.changedFields} />
          <ProjectsTable adminKey={adminKey} />
          <NodesTable adminKey={adminKey} />
          <SignalFlow
            connectedNodes={nodes.data ?? []}
            signals={signals}
            isAuthed={isAuthed}
          />
          <ServerLogs
            logs={logs}
            signals={signals}
            connectedNodes={nodes.data ?? []}
            isAuthed={isAuthed}
          />
        </>
      )}
    </div>
  );
}
```

Note: `ConnectedNodes` section is removed — peers are now in the `ServerLogs` sidebar.

**Step 2: Commit**

```bash
git add packages/admin/src/App.tsx
git commit -m "feat(admin): wire SignalFlow and useSignalStream into App"
```

---

## Task 10: Override React Flow default styles

**Files:**
- Modify: `packages/admin/src/styles/globals.css`

React Flow injects its own CSS. We need to neutralize the default light-mode background and edge colors so they don't fight the Dune theme.

**Step 1: Add overrides at the bottom of globals.css**

```css
/* React Flow theme overrides */
.react-flow__renderer {
  background: transparent;
}
.react-flow__edge-path {
  stroke: oklch(0.28 0.04 65);
}
.react-flow__minimap {
  display: none;
}
.react-flow__controls {
  display: none;
}
```

**Step 2: Commit**

```bash
git add packages/admin/src/styles/globals.css
git commit -m "feat(admin): override React Flow default styles for Dune theme"
```

---

## Task 11: Build verification

**Step 1: TypeScript check**

```bash
cd packages/admin && pnpm exec tsc --noEmit
```
Fix any type errors before proceeding.

**Step 2: Server tests**

```bash
bun test packages/server/test/log-buffer.test.ts packages/node
```
Expected: all pass (Redis tests still fail — acceptable)

**Step 3: Admin build**

```bash
cd packages/admin && pnpm build
```
Expected: build succeeds with no errors.

**Step 4: Final commit if clean**

```bash
git add -A
git commit -m "chore: final build verification pass"
```
