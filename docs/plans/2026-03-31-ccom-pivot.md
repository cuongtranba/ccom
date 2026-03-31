# ccom Pivot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename and strip inv → ccom: remove all inventory concepts, expose only 3 stateless MCP tools (ccom_ask, ccom_reply, ccom_online_nodes).

**Architecture:** Delete store/state/signal/engine. Shrink shared types to query_ask/query_respond/ack/error. WSHandlers becomes a 5-line passthrough. channel.ts directly calls wsClient—no engine needed.

**Tech Stack:** Bun, @modelcontextprotocol/sdk, bun:test, bun:sqlite gone

**Working directory:** `.worktrees/feature/ccom-pivot`

---

### Task 1: Strip shared/src/types.ts

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/index.ts`

**Step 1: Overwrite types.ts — keep only Vertical**

```ts
export type Vertical = string;
```

**Step 2: Check what index.ts exports from types**

```bash
cat packages/shared/src/index.ts
```

Remove all exports except `Vertical`, `Envelope`, `MessagePayload`, `createEnvelope`, `parseEnvelope`, `slugify`.

**Step 3: Run shared tests**

```bash
bun test packages/shared
```

Expected: PASS (types.test.ts tests `ItemState`, `ItemKind`, etc. — delete those tests too)

**Step 3b: Delete shared/src/types.test.ts**

This tests inventory types that no longer exist.

```bash
rm packages/shared/src/types.test.ts
```

**Step 4: Run shared tests again**

```bash
bun test packages/shared
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/types.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): strip types to Vertical only"
```

---

### Task 2: Strip shared/src/messages.ts

**Files:**
- Modify: `packages/shared/src/messages.ts`
- Delete: `packages/shared/src/messages.test.ts` (tests inventory message types)

**Step 1: Write failing test first — verify only 4 payload types exist**

Open `packages/shared/src/messages.ts` test. The current test asserts inventory types. Delete `messages.test.ts`, then create a minimal replacement:

```ts
// packages/shared/src/messages.test.ts
import { describe, test, expect } from "bun:test";
import { createEnvelope, parseEnvelope } from "./messages";

describe("messages", () => {
  test("createEnvelope builds valid envelope", () => {
    const env = createEnvelope("node-a", "node-b", "proj", {
      type: "query_ask",
      question: "hello",
      askerId: "node-a",
    });
    expect(env.fromNode).toBe("node-a");
    expect(env.toNode).toBe("node-b");
    expect(env.payload.type).toBe("query_ask");
    expect(env.messageId).toBeTruthy();
  });

  test("parseEnvelope round-trips", () => {
    const env = createEnvelope("a", "b", "p", { type: "ack", originalMessageId: "x" });
    const parsed = parseEnvelope(JSON.stringify(env));
    expect(parsed.messageId).toBe(env.messageId);
    expect(parsed.payload.type).toBe("ack");
  });
});
```

**Step 2: Run test — verify it fails (old MessagePayload still has inventory types)**

```bash
bun test packages/shared/src/messages.test.ts
```

Expected: PASS (createEnvelope and parseEnvelope haven't changed yet) — actually this will pass. Move on.

**Step 3: Overwrite messages.ts**

```ts
import { randomUUID } from "crypto";

export interface Envelope {
  messageId: string;
  fromNode: string;
  toNode: string;
  projectId: string;
  timestamp: string;
  payload: MessagePayload;
}

export type MessagePayload =
  | { type: "query_ask"; question: string; askerId: string; queryId?: string }
  | { type: "query_respond"; answer: string; responderId: string; replyTo?: string }
  | { type: "ack"; originalMessageId: string }
  | { type: "error"; code: string; message: string };

export function createEnvelope(
  fromNode: string,
  toNode: string,
  projectId: string,
  payload: MessagePayload,
): Envelope {
  return {
    messageId: randomUUID(),
    fromNode,
    toNode,
    projectId,
    timestamp: new Date().toISOString(),
    payload,
  };
}

export function parseEnvelope(raw: string): Envelope {
  const parsed = JSON.parse(raw);
  if (!parsed.messageId || !parsed.payload?.type) {
    throw new Error("Invalid envelope");
  }
  return parsed as Envelope;
}
```

**Step 4: Run tests**

```bash
bun test packages/shared
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/shared/src/messages.ts packages/shared/src/messages.test.ts
git commit -m "feat(shared): strip MessagePayload to query_ask/query_respond/ack/error"
```

---

### Task 3: Delete inventory source files and tests in node package

**Files to delete:**
- `packages/node/src/store.ts`
- `packages/node/src/state.ts`
- `packages/node/src/signal.ts`
- `packages/node/src/engine.ts`
- `packages/node/test/store.test.ts`
- `packages/node/test/state.test.ts`
- `packages/node/test/signal.test.ts`
- `packages/node/test/engine.test.ts`
- `packages/node/test/scenarios.test.ts`
- `packages/node/test/scenarios-vote-challenge.test.ts`
- `packages/node/test/integration.test.ts` (tests inventory scenarios)

**Step 1: Delete all at once**

```bash
rm packages/node/src/store.ts packages/node/src/state.ts packages/node/src/signal.ts packages/node/src/engine.ts
rm packages/node/test/store.test.ts packages/node/test/state.test.ts packages/node/test/signal.test.ts
rm packages/node/test/engine.test.ts packages/node/test/scenarios.test.ts packages/node/test/scenarios-vote-challenge.test.ts
rm packages/node/test/integration.test.ts
```

**Step 2: Run tests — expect compile errors in remaining test files (they import deleted files)**

```bash
bun test packages/node/test/event-bus.test.ts packages/node/test/ws-client.test.ts packages/node/test/logger.test.ts packages/node/test/config.test.ts
```

These 4 tests don't import deleted files — they should still pass.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(node): delete inventory source files and their tests"
```

---

### Task 4: Strip event-bus.ts

**Files:**
- Modify: `packages/node/src/event-bus.ts`
- Test: `packages/node/test/event-bus.test.ts`

**Step 1: Update event-bus.ts**

Replace entire file:

```ts
export type EventType = "query_ask" | "query_respond" | "ack" | "error";

type EventHandler = (data: unknown) => void;

export class EventBus {
  private listeners = new Map<EventType, Set<EventHandler>>();

  on(event: EventType, handler: EventHandler): void {
    let handlers = this.listeners.get(event);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(event, handlers);
    }
    handlers.add(handler);
  }

  off(event: EventType, handler: EventHandler): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  emit(event: EventType, data: unknown): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(data);
    }
  }
}
```

**Step 2: Run existing event-bus test**

```bash
bun test packages/node/test/event-bus.test.ts
```

Expected: PASS (EventBus API unchanged, just fewer event types)

**Step 3: Commit**

```bash
git add packages/node/src/event-bus.ts
git commit -m "feat(node): strip event-bus to 4 ccom event types"
```

---

### Task 5: Rewrite ws-handlers.ts + update test

**Files:**
- Modify: `packages/node/src/ws-handlers.ts`
- Modify: `packages/node/test/ws-handlers.test.ts`

**Step 1: Write new ws-handlers.test.ts**

Replace entire file:

```ts
import { describe, it, expect } from "bun:test";
import { EventBus } from "../src/event-bus";
import { WSHandlers } from "../src/ws-handlers";
import type { Envelope } from "@inv/shared";

function makeEnvelope(
  payload: Envelope["payload"],
  fromNode = "node-a",
  toNode = "node-b",
): Envelope {
  return {
    messageId: "msg-1",
    fromNode,
    toNode,
    projectId: "proj-1",
    timestamp: new Date().toISOString(),
    payload,
  };
}

describe("WSHandlers", () => {
  it("forwards query_ask to eventBus with fromNode", () => {
    const eventBus = new EventBus();
    const handlers = new WSHandlers(eventBus);
    let received: unknown = null;
    eventBus.on("query_ask", (data) => { received = data; });

    handlers.handle(makeEnvelope({ type: "query_ask", question: "hey?", askerId: "node-a" }, "node-a", "node-b"));

    expect((received as { type: string }).type).toBe("query_ask");
    expect((received as { fromNode: string }).fromNode).toBe("node-a");
    expect((received as { question: string }).question).toBe("hey?");
  });

  it("forwards query_respond to eventBus", () => {
    const eventBus = new EventBus();
    const handlers = new WSHandlers(eventBus);
    let received: unknown = null;
    eventBus.on("query_respond", (data) => { received = data; });

    handlers.handle(makeEnvelope({ type: "query_respond", answer: "42", responderId: "node-b" }));

    expect((received as { answer: string }).answer).toBe("42");
  });

  it("forwards ack to eventBus", () => {
    const eventBus = new EventBus();
    const handlers = new WSHandlers(eventBus);
    let fired = false;
    eventBus.on("ack", () => { fired = true; });

    handlers.handle(makeEnvelope({ type: "ack", originalMessageId: "orig" }));

    expect(fired).toBe(true);
  });

  it("forwards error to eventBus", () => {
    const eventBus = new EventBus();
    const handlers = new WSHandlers(eventBus);
    let fired = false;
    eventBus.on("error", () => { fired = true; });

    handlers.handle(makeEnvelope({ type: "error", code: "E", message: "msg" }));

    expect(fired).toBe(true);
  });
});
```

**Step 2: Run test — expect FAIL (WSHandlers still has old signature)**

```bash
bun test packages/node/test/ws-handlers.test.ts
```

Expected: compile error or test failure

**Step 3: Rewrite ws-handlers.ts**

```ts
import type { Envelope } from "@inv/shared";
import type { EventBus, EventType } from "./event-bus";

export class WSHandlers {
  constructor(private eventBus: EventBus) {}

  handle(envelope: Envelope): void {
    const { payload } = envelope;
    this.eventBus.emit(payload.type as EventType, {
      ...payload,
      fromNode: envelope.fromNode,
    });
  }
}
```

**Step 4: Run test — expect PASS**

```bash
bun test packages/node/test/ws-handlers.test.ts
```

Expected: 4 pass, 0 fail

**Step 5: Commit**

```bash
git add packages/node/src/ws-handlers.ts packages/node/test/ws-handlers.test.ts
git commit -m "feat(node): rewrite WSHandlers — stateless passthrough, no store or engine"
```

---

### Task 6: Update config.ts

**Files:**
- Modify: `packages/node/src/config.ts`
- Modify: `packages/node/test/config.test.ts`

**Step 1: Read config.test.ts first**

```bash
cat packages/node/test/config.test.ts
```

**Step 2: Rewrite config.ts — drop database and autonomy**

```ts
export interface NodeConfig {
  node: {
    id: string;
    name: string;
    vertical: string;
    projects: string[];
    owner: string;
    isAI: boolean;
  };
  server: {
    url: string;
    token: string;
  };
}

export function defaultConfig(): NodeConfig {
  return {
    node: {
      id: "",
      name: "",
      vertical: "dev",
      projects: [],
      owner: "",
      isAI: false,
    },
    server: {
      url: "ws://localhost:8080/ws",
      token: "",
    },
  };
}

export function loadConfig(partial: Record<string, unknown>): NodeConfig {
  const cfg = defaultConfig();
  return deepMerge(cfg, partial) as NodeConfig;
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      );
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}
```

**Step 3: Update config.test.ts to drop database assertions**

Remove any assertions about `config.database.*` or `config.autonomy.*`.

**Step 4: Run config tests**

```bash
bun test packages/node/test/config.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/node/src/config.ts packages/node/test/config.test.ts
git commit -m "feat(node): remove database and autonomy from NodeConfig"
```

---

### Task 7: Strip channel.ts to 3 ccom_ tools + update test

**Files:**
- Modify: `packages/node/src/channel.ts`
- Modify: `packages/node/test/channel.test.ts`

**Step 1: Write new channel.test.ts**

Replace entire file:

```ts
import { describe, test, expect } from "bun:test";
import { TOOL_DEFINITIONS, buildToolHandlers } from "../src/channel";
import type { NodeConfig } from "../src/config";

const config: NodeConfig = {
  node: { id: "node-1", name: "test-node", vertical: "dev", projects: ["proj"], owner: "tester", isAI: false },
  server: { url: "ws://localhost:8080/ws", token: "tok" },
};

describe("channel tool definitions", () => {
  test("defines exactly 3 tools", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(3);
  });

  test("tool names are ccom_ prefixed", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toEqual(["ccom_ask", "ccom_reply", "ccom_online_nodes"]);
  });

  test("all tools have name, description, inputSchema", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
    }
  });
});

describe("buildToolHandlers", () => {
  test("ccom_ask without wsClient returns networkSent: false", async () => {
    const handleTool = buildToolHandlers(config, null);
    const result = await handleTool("ccom_ask", { question: "hello?" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.networkSent).toBe(false);
    expect(parsed.broadcast).toBe(true);
  });

  test("ccom_ask with targetNode sets broadcast: false", async () => {
    const handleTool = buildToolHandlers(config, null);
    const result = await handleTool("ccom_ask", { question: "hi", targetNode: "other-node" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.broadcast).toBe(false);
  });

  test("ccom_reply without wsClient returns error", async () => {
    const handleTool = buildToolHandlers(config, null);
    const result = await handleTool("ccom_reply", { answer: "yes", targetNode: "node-2" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });

  test("unknown tool returns error", async () => {
    const handleTool = buildToolHandlers(config, null);
    const result = await handleTool("unknown_tool", {});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("Unknown tool");
  });
});
```

**Step 2: Run test — expect FAIL (TOOL_DEFINITIONS still has 16 tools)**

```bash
bun test packages/node/test/channel.test.ts
```

Expected: FAIL — `expected 16 to equal 3`

**Step 3: Rewrite channel.ts**

Full replacement. Key parts:

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { Logger } from "./logger";
import { EventBus } from "./event-bus";
import { WSHandlers } from "./ws-handlers";
import { WSClient } from "./ws-client";
import { loadConfig } from "./config";
import type { NodeConfig } from "./config";

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "ccom_ask",
    description: "Send a message to another Claude Code node on the network. Optionally target a specific node; otherwise broadcasts to all nodes in the project.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The message or question to send" },
        targetNode: { type: "string", description: "Optional target node ID. Omit to broadcast." },
      },
      required: ["question"],
    },
  },
  {
    name: "ccom_reply",
    description: "Reply to a message received from another node. Use when you receive a query_ask event.",
    inputSchema: {
      type: "object",
      properties: {
        answer: { type: "string", description: "Your reply" },
        targetNode: { type: "string", description: "Node ID to reply to" },
        queryId: { type: "string", description: "Optional query ID for correlation" },
      },
      required: ["answer", "targetNode"],
    },
  },
  {
    name: "ccom_online_nodes",
    description: "List all Claude Code nodes currently connected to the network.",
    inputSchema: { type: "object", properties: {} },
  },
];

// ── Online Nodes Helper ────────────────────────────────────────────────

interface OnlineNode {
  nodeId: string;
  name: string;
  vertical: string;
}

async function fetchOnlineNodes(serverUrl: string, token: string, excludeNodeId?: string): Promise<OnlineNode[]> {
  try {
    const httpUrl = serverUrl.replace(/^ws/, "http").replace(/\/ws$/, "/api/online");
    const res = await fetch(`${httpUrl}?token=${token}`);
    if (!res.ok) return [];
    const data = await res.json() as { projects: { nodes: OnlineNode[] }[] };
    const seen = new Set<string>();
    const nodes: OnlineNode[] = [];
    for (const proj of data.projects) {
      for (const n of proj.nodes) {
        if (!seen.has(n.nodeId) && n.nodeId !== excludeNodeId) {
          seen.add(n.nodeId);
          nodes.push({ nodeId: n.nodeId, name: n.name, vertical: n.vertical });
        }
      }
    }
    return nodes;
  } catch {
    return [];
  }
}

// ── Tool Handlers ──────────────────────────────────────────────────────

interface ToolCallArgs {
  [key: string]: string | boolean | undefined;
}

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
}

export function buildToolHandlers(
  config: NodeConfig,
  wsClient: WSClient | null,
): (name: string, args: ToolCallArgs) => Promise<ToolResult> {
  return async (name: string, args: ToolCallArgs): Promise<ToolResult> => {
    const text = (s: string): ToolResult => ({ content: [{ type: "text", text: s }] });

    try {
      switch (name) {
        case "ccom_ask": {
          const question = args.question ?? "";
          if (wsClient) {
            if (args.targetNode) {
              wsClient.sendMessage(args.targetNode, config.node.projects[0] ?? "", {
                type: "query_ask",
                question,
                askerId: config.node.id,
              });
            } else {
              wsClient.broadcast(config.node.projects[0] ?? "", {
                type: "query_ask",
                question,
                askerId: config.node.id,
              });
            }
          }
          return text(JSON.stringify({
            broadcast: !args.targetNode,
            networkSent: wsClient !== null,
          }, null, 2));
        }

        case "ccom_reply": {
          if (!wsClient) return text(JSON.stringify({ error: "Not connected to server" }));
          const answer = args.answer ?? "";
          if (!answer) return text(JSON.stringify({ error: "Answer cannot be empty" }));
          wsClient.sendMessage(args.targetNode ?? "", config.node.projects[0] ?? "", {
            type: "query_respond",
            answer,
            responderId: config.node.id,
            ...(args.queryId ? { replyTo: args.queryId } : {}),
          });
          return text(JSON.stringify({ sent: true, targetNode: args.targetNode }, null, 2));
        }

        case "ccom_online_nodes": {
          const nodes = await fetchOnlineNodes(config.server.url, config.server.token, config.node.id);
          if (nodes.length === 0) return text("No other nodes online.");
          const lines = nodes.map((n) => `${n.name} (${n.vertical}) — ${n.nodeId}`);
          return text(lines.join("\n"));
        }

        default:
          return text(JSON.stringify({ error: `Unknown tool: ${name}` }));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return text(JSON.stringify({ error: message }));
    }
  };
}

// ── Channel Server Main ────────────────────────────────────────────────

export async function startChannelServer(configPath: string): Promise<void> {
  if (!existsSync(configPath)) throw new Error(`Config file not found: ${configPath}`);
  const raw = readFileSync(configPath, "utf-8");
  const config = loadConfig(JSON.parse(raw) as Record<string, unknown>);

  const eventBus = new EventBus();
  const wsHandlers = new WSHandlers(eventBus);

  let wsClient: WSClient | null = null;

  if (config.server.url && config.server.token) {
    wsClient = new WSClient({
      serverUrl: config.server.url,
      token: config.server.token,
      nodeId: config.node.id,
      projectIds: config.node.projects,
    });
    wsClient.onMessage((envelope) => wsHandlers.handle(envelope));
    try {
      await wsClient.connect();
    } catch {
      // wsClient keeps retrying via internal reconnect
    }
  }

  const handleTool = buildToolHandlers(config, wsClient);

  const mcp = new Server(
    { name: "ccom", version: "0.1.0" },
    {
      capabilities: {
        experimental: { "claude/channel": {}, "claude/channel/permission": {} },
        tools: {},
      },
      instructions: `You are connected to the ccom network as node "${config.node.name}" (${config.node.vertical}, projects: ${config.node.projects.join(", ")}, owner: ${config.node.owner}).

Events from other nodes arrive as <channel source="ccom"> tags:
- query_ask: another node sent you a message — use ccom_reply to respond
- query_respond: a reply to your previous ccom_ask

Available tools: ccom_ask, ccom_reply, ccom_online_nodes`,
    },
  );

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));

  mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await handleTool(
      request.params.name,
      (request.params.arguments ?? {}) as ToolCallArgs,
    );
    return result;
  });

  // Wire eventBus → MCP channel
  const channelPayloads: unknown[] = [];
  for (const eventType of ["query_ask", "query_respond", "ack", "error"] as const) {
    eventBus.on(eventType, (data) => channelPayloads.push(data));
  }

  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}
```

**Step 4: Run channel tests**

```bash
bun test packages/node/test/channel.test.ts
```

Expected: 7 pass, 0 fail

**Step 5: Commit**

```bash
git add packages/node/src/channel.ts packages/node/test/channel.test.ts
git commit -m "feat(node): strip channel to 3 ccom_ tools, remove engine dependency"
```

---

### Task 8: Update cli.ts + test

**Files:**
- Modify: `packages/node/src/cli.ts`
- Modify: `packages/node/test/cli.test.ts`

**Step 1: Write updated cli.test.ts**

Replace key assertions:

```ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { generateCcomConfig, generateMcpConfig, detectExistingFiles } from "../src/cli";

describe("CLI config generation", () => {
  test("generateCcomConfig creates valid config without database field", () => {
    const config = generateCcomConfig({
      name: "dev-node",
      vertical: "dev",
      projects: ["my-project"],
      owner: "cuong",
      serverUrl: "ws://localhost:8080/ws",
      token: "test-token",
    });

    expect(config.node.name).toBe("dev-node");
    expect(config.node.vertical).toBe("dev");
    expect(config.server.url).toBe("ws://localhost:8080/ws");
    expect((config as unknown as { database?: unknown }).database).toBeUndefined();
  });

  test("generateMcpConfig creates ccom entry", () => {
    const config = generateMcpConfig("./ccom-config.json");
    expect(config.mcpServers.ccom).toBeTruthy();
    expect(config.mcpServers.ccom.args).toContain("@tini-works/ccom@latest");
    expect(config.mcpServers.ccom.args).toContain("./ccom-config.json");
  });

  test("detectExistingFiles checks ccom-config.json", () => {
    const dir = tmpdir();
    const configPath = join(dir, "ccom-config.json");
    writeFileSync(configPath, "{}");
    const files = detectExistingFiles(configPath);
    expect(files).toContain(configPath);
    unlinkSync(configPath);
  });
});
```

**Step 2: Run — expect FAIL (generateCcomConfig not exported)**

```bash
bun test packages/node/test/cli.test.ts
```

Expected: import error

**Step 3: Update cli.ts**

Changes to make:
- Rename `generateInvConfig` → `generateCcomConfig`
- Remove `dbPath` from `WizardInput` interface
- Remove `database` from `InvConfig` (rename to `CcomConfig`)
- Update `generateMcpConfig`: MCP key `"inventory"` → `"ccom"`, package `@tini-works/inv-node@latest` → `@tini-works/ccom@latest`
- Update wizard: remove db prompt, use `ccom-config.json` everywhere
- Update `detectExistingFiles`: check `ccom-config.json` instead of `inv-config.json`
- Update console messages to say "ccom" not "inventory"
- Update channel start message: `server:ccom` not `server:inventory`

**Step 4: Run tests**

```bash
bun test packages/node/test/cli.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/node/src/cli.ts packages/node/test/cli.test.ts
git commit -m "feat(node): rename cli — generateCcomConfig, ccom-config.json, @tini-works/ccom"
```

---

### Task 9: Rename package.json files

**Files:**
- Modify: `packages/node/package.json`
- Modify: `packages/shared/package.json`
- Modify: `bunfig.toml` (if it has workspace alias for @inv/shared)

**Step 1: Check workspace alias**

```bash
cat bunfig.toml
grep -r "@inv/shared" packages/node/package.json packages/server/package.json
```

**Step 2: Update packages/node/package.json**

```json
{
  "name": "@tini-works/ccom",
  "version": "0.1.0",
  "bin": {
    "ccom": "./dist/cli.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "bun build src/index.ts --target=bun --outdir=dist --entry-naming=cli.js --external=@modelcontextprotocol/sdk && echo '#!/usr/bin/env bun' | cat - dist/cli.js > dist/cli.tmp && mv dist/cli.tmp dist/cli.js && chmod +x dist/cli.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.28.0"
  },
  "publishConfig": {
    "registry": "https://registry.npmjs.org",
    "access": "public"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/tini-works/ccom.git",
    "directory": "packages/node"
  }
}
```

**Step 3: Run full node test suite**

```bash
bun test packages/node
```

Expected: all remaining tests pass

**Step 4: Commit**

```bash
git add packages/node/package.json packages/shared/package.json bunfig.toml
git commit -m "feat: rename packages — @tini-works/ccom, @ccom/shared"
```

---

### Task 10: Update CI workflow

**Files:**
- Modify: `.github/workflows/release-node.yml`

**Step 1: Replace the entire workflow**

```yaml
name: Release @tini-works/ccom

on:
  workflow_dispatch:
  push:
    branches: [main]
    paths:
      - "packages/node/**"
      - "packages/shared/**"
  pull_request:
    branches: [main]
    paths:
      - "packages/node/**"
      - "packages/shared/**"

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.11"

      - name: Install dependencies
        run: bun install

      - name: Run tests
        run: bun test packages/node packages/shared

      - name: Build @tini-works/ccom
        run: bun run build:node

      - name: Verify build output
        run: |
          test -f packages/node/dist/cli.js || (echo "Build output missing" && exit 1)
          bun packages/node/dist/cli.js bogus 2>&1 | grep -q "Unknown command" || (echo "CLI routing broken" && exit 1)

  release:
    needs: test
    if: github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')
    runs-on: ubuntu-latest
    permissions:
      contents: write
      packages: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.11"

      - name: Install dependencies
        run: bun install

      - name: Build @tini-works/ccom
        run: bun run build:node

      - name: Determine next version
        id: version
        run: |
          LATEST_TAG=$(git tag -l 'ccom@*' --sort=-v:refname | head -1)
          if [ -z "$LATEST_TAG" ]; then
            NEXT_VERSION="0.1.0"
          else
            CURRENT_VERSION="${LATEST_TAG#ccom@}"
            IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
            NEXT_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))"
          fi
          echo "version=$NEXT_VERSION" >> "$GITHUB_OUTPUT"
          echo "tag=ccom@$NEXT_VERSION" >> "$GITHUB_OUTPUT"
          echo "Next version: $NEXT_VERSION"

      - name: Update package.json version
        run: |
          cd packages/node
          jq --arg v "${{ steps.version.outputs.version }}" '.version = $v' package.json > package.json.tmp
          mv package.json.tmp package.json

      - name: Publish to npm
        run: cd packages/node && bun publish --tolerate-republish
        env:
          NPM_CONFIG_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Commit version bump, tag, and push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add packages/node/package.json
          git commit -m "chore(node): release ${{ steps.version.outputs.tag }} [skip ci]"
          git tag "${{ steps.version.outputs.tag }}"
          git push origin main --tags

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ steps.version.outputs.tag }}
          name: "@tini-works/ccom ${{ steps.version.outputs.version }}"
          generate_release_notes: true
```

**Step 2: Commit**

```bash
git add .github/workflows/release-node.yml
git commit -m "ci: switch to ubuntu-latest, rename to ccom, drop prisma step"
```

---

### Task 11: Update landing page

**Files:**
- Modify: `web/src/pages/index.astro`
- Delete: `web/src/components/StateMachine.astro`
- Delete: `web/src/components/CrossTeamCascade.astro`
- Delete: `web/src/components/GovernanceLifecycle.astro`
- Modify: `web/src/components/ClaudeCodeDemo.astro`

**Step 1: Read current index.astro fully**

```bash
cat web/src/pages/index.astro
```

**Step 2: Replace index.astro narrative**

New structure:

```astro
---
import Base from '../layouts/Base.astro';
import SectionHeader from '../components/SectionHeader.astro';
import ClaudeCodeDemo from '../components/ClaudeCodeDemo.astro';
---

<Base title="ccom — Claude Code Communication">

  <!-- HERO -->
  <section class="hero">
    <p class="hero-eyebrow">ccom — Claude Code Communication</p>
    <h1 class="hero-title">
      Claude Code instances,<br />
      <span class="highlight">talking to each other.</span>
    </h1>
    <p class="hero-sub">
      Run Claude Code on multiple machines. Each instance registers as a node.
      Nodes find each other, send messages, and receive replies — directly in their Claude sessions.
    </p>
  </section>

  <!-- HOW IT WORKS -->
  <section class="section">
    <SectionHeader
      label="01 — How it works"
      title="Three tools. One network."
      description="ccom_ask sends a message to another node. ccom_reply sends your answer back. ccom_online_nodes shows who's connected. Messages appear as channel events in Claude's session — no polling, no webhooks."
    />
    <ClaudeCodeDemo />
  </section>

  <!-- GET STARTED -->
  <section class="section">
    <SectionHeader
      label="02 — Get Started"
      title="Three steps."
      description="Register your node at the server, run the wizard, start Claude Code with channels enabled."
    />

    <div class="setup-steps">
      <div class="setup-step">
        <div class="step-number">1</div>
        <div class="step-content">
          <h3 class="step-title">Register at the admin console</h3>
          <p class="step-desc">Visit the server's admin page. Pick a node name, get your token.</p>
          <div class="step-terminal">
            <code>https://inv-server.apps.quickable.co/admin</code>
          </div>
        </div>
      </div>
      <div class="setup-step">
        <div class="step-number">2</div>
        <div class="step-content">
          <h3 class="step-title">Run the setup wizard</h3>
          <p class="step-desc">Enter your server URL and token. Writes ccom-config.json and .mcp.json.</p>
          <div class="step-terminal">
            <code>bunx @tini-works/ccom init</code>
          </div>
        </div>
      </div>
      <div class="setup-step">
        <div class="step-number">3</div>
        <div class="step-content">
          <h3 class="step-title">Start Claude Code with channels</h3>
          <p class="step-desc">Messages from other nodes appear as channel events in your session.</p>
          <div class="step-terminal">
            <code>claude --dangerously-load-development-channels server:ccom</code>
          </div>
        </div>
      </div>
    </div>
  </section>

</Base>
```

**Step 3: Delete unused components**

```bash
rm web/src/components/StateMachine.astro
rm web/src/components/CrossTeamCascade.astro
rm web/src/components/GovernanceLifecycle.astro
```

**Step 4: Update ClaudeCodeDemo.astro copy to reflect ccom_ask/ccom_reply**

Read the current file first, then update any tool names from `inv_ask`/`inv_reply` to `ccom_ask`/`ccom_reply`.

**Step 5: Verify web builds**

```bash
cd web && bun run build 2>&1 | tail -10
```

Expected: no errors

**Step 6: Commit**

```bash
git add web/
git commit -m "feat(web): rewrite landing page for ccom communication narrative"
```

---

### Task 12: Update README and CLAUDE.md

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Rename: `inv-config.example.json` → `ccom-config.example.json`

**Step 1: Read current README.md top section**

```bash
head -100 README.md
```

**Step 2: Rewrite README.md**

Key changes:
- Title: `# ccom — Claude Code Communication`
- Badge: update workflow name
- Description: "Real-time communication network for Claude Code instances"
- Remove: state machine, signal propagation, inventory concepts
- Keep: WebSocket server setup, node registration, MCP channel usage
- Update: install command (`bunx @tini-works/ccom init`)
- Update: `.mcp.json` example (server name `"ccom"`, package `@tini-works/ccom@latest`)
- Document: 3 tools only
- Update: Claude Code start command (`server:ccom`)

**Step 3: Update CLAUDE.md**

- Update architecture section: remove Store, StateMachine, SignalPropagator
- Update message flow diagram: `Claude → MCP stdio → channel.ts → WSClient → Central Server → Other Nodes`
- Update tool count: "3 tools" not "21 tools"
- Remove: "Adding a New MCP Tool" steps that reference store/engine
- Update: commands section (remove Redis caveat for `bun test packages/server`)
- Update: package name references

**Step 4: Rename example config**

```bash
mv inv-config.example.json ccom-config.example.json
```

Update any README references to use `ccom-config.example.json`.

**Step 5: Commit**

```bash
git add README.md CLAUDE.md ccom-config.example.json
git commit -m "docs: update README and CLAUDE.md for ccom pivot"
```

---

### Task 13: Final verification

**Step 1: Run full test suite**

```bash
bun test packages/node packages/shared
```

Expected: all pass, 0 fail

**Step 2: Build the CLI**

```bash
bun run build:node
```

Expected: `packages/node/dist/cli.js` created

**Step 3: Smoke test CLI**

```bash
bun packages/node/dist/cli.js bogus 2>&1
```

Expected: `Unknown command: bogus`

**Step 4: Commit if any fixups needed, then push branch**

```bash
git push origin feature/ccom-pivot
```
