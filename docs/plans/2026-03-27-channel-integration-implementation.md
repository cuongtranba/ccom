# Channel Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace custom TUI + Agent SDK with a Claude Code Channel MCP server that bridges the inventory network into Claude Code sessions.

**Architecture:** Single MCP server (`channel.ts`) connects to central server via WebSocket, exposes inventory tools, pushes network events as `<channel>` tags, and relays permission requests. An `inv init` wizard collects config and prints the command to start Claude Code.

**Tech Stack:** Bun, `@modelcontextprotocol/sdk`, `@inv/shared` (workspace), `bun:sqlite`

**Design:** [2026-03-27-channel-integration-design.md](./2026-03-27-channel-integration-design.md)

---

### Task 1: Add ToolArgs and Permission Message Types to Shared Package

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/messages.ts`
- Test: `packages/shared/test/messages.test.ts`

**Step 1: Write the failing test**

Add tests for new message types in `packages/shared/test/messages.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { createEnvelope, parseEnvelope } from "../src/messages";

describe("permission_request envelope", () => {
  test("round-trips permission_request with inv_mark_broken args", () => {
    const envelope = createEnvelope("node-a", "node-b", "proj-1", {
      type: "permission_request",
      requestId: "req-1",
      tool: "inv_mark_broken",
      itemId: "item-1",
      reason: "broken in prod",
    });
    const parsed = parseEnvelope(JSON.stringify(envelope));
    expect(parsed.payload.type).toBe("permission_request");
    if (parsed.payload.type === "permission_request") {
      expect(parsed.payload.tool).toBe("inv_mark_broken");
      expect(parsed.payload.requestId).toBe("req-1");
    }
  });

  test("round-trips permission_request with inv_add_item args", () => {
    const envelope = createEnvelope("node-a", "node-b", "proj-1", {
      type: "permission_request",
      requestId: "req-2",
      tool: "inv_add_item",
      name: "New API Spec",
      kind: "api-spec",
      vertical: "dev",
    });
    const parsed = parseEnvelope(JSON.stringify(envelope));
    if (parsed.payload.type === "permission_request") {
      expect(parsed.payload.tool).toBe("inv_add_item");
      if (parsed.payload.tool === "inv_add_item") {
        expect(parsed.payload.name).toBe("New API Spec");
        expect(parsed.payload.kind).toBe("api-spec");
        expect(parsed.payload.vertical).toBe("dev");
      }
    }
  });
});

describe("permission_verdict envelope", () => {
  test("round-trips permission_verdict allowed", () => {
    const envelope = createEnvelope("node-b", "node-a", "proj-1", {
      type: "permission_verdict",
      requestId: "req-1",
      allowed: true,
    });
    const parsed = parseEnvelope(JSON.stringify(envelope));
    expect(parsed.payload.type).toBe("permission_verdict");
    if (parsed.payload.type === "permission_verdict") {
      expect(parsed.payload.allowed).toBe(true);
      expect(parsed.payload.requestId).toBe("req-1");
    }
  });

  test("round-trips permission_verdict denied with reason", () => {
    const envelope = createEnvelope("node-b", "node-a", "proj-1", {
      type: "permission_verdict",
      requestId: "req-1",
      allowed: false,
      reason: "Not authorized for this action",
    });
    const parsed = parseEnvelope(JSON.stringify(envelope));
    if (parsed.payload.type === "permission_verdict") {
      expect(parsed.payload.allowed).toBe(false);
      expect(parsed.payload.reason).toBe("Not authorized for this action");
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/shared/test/messages.test.ts`
Expected: TypeScript compile errors — `permission_request` and `permission_verdict` don't exist on `MessagePayload`.

**Step 3: Add ToolArgs type to types.ts**

In `packages/shared/src/types.ts`, add after the `UPSTREAM_VERTICALS` export:

```typescript
export type ToolArgs =
  | { tool: "inv_add_item"; name: string; kind: ItemKind; vertical: Vertical; externalRef?: string }
  | { tool: "inv_add_trace"; fromItemId: string; toItemId: string; relation: TraceRelation }
  | { tool: "inv_verify"; itemId: string }
  | { tool: "inv_mark_broken"; itemId: string; reason?: string }
  | { tool: "inv_audit" }
  | { tool: "inv_ask"; question: string; targetNode?: string }
  | { tool: "inv_reply"; message: string; targetNode: string };
```

**Step 4: Add permission message types to messages.ts**

In `packages/shared/src/messages.ts`, add to `MessagePayload` union (import `ToolArgs` from types):

```typescript
  | ({ type: "permission_request"; requestId: string } & ToolArgs)
  | { type: "permission_verdict"; requestId: string; allowed: boolean; reason?: string }
```

**Step 5: Run test to verify it passes**

Run: `bun test packages/shared/test/messages.test.ts`
Expected: All tests PASS.

**Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/messages.ts packages/shared/test/messages.test.ts
git commit -m "feat(shared): add ToolArgs type and permission message types"
```

---

### Task 2: Update EventBus for Permission Events

**Files:**
- Modify: `packages/node/src/event-bus.ts`
- Test: `packages/node/test/event-bus.test.ts` (create if missing)

**Step 1: Write the failing test**

```typescript
import { describe, test, expect } from "bun:test";
import { EventBus } from "../src/event-bus";

describe("EventBus permission events", () => {
  test("emits and receives permission_request", () => {
    const bus = new EventBus();
    let received: unknown = null;
    bus.on("permission_request", (data) => { received = data; });
    bus.emit("permission_request", { requestId: "r1", tool: "inv_verify", itemId: "i1" });
    expect(received).toEqual({ requestId: "r1", tool: "inv_verify", itemId: "i1" });
  });

  test("emits and receives permission_verdict", () => {
    const bus = new EventBus();
    let received: unknown = null;
    bus.on("permission_verdict", (data) => { received = data; });
    bus.emit("permission_verdict", { requestId: "r1", allowed: true });
    expect(received).toEqual({ requestId: "r1", allowed: true });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/node/test/event-bus.test.ts`
Expected: TypeScript error — `"permission_request"` is not assignable to `EventType`.

**Step 3: Add new event types**

In `packages/node/src/event-bus.ts`, update `EventType`:

```typescript
export type EventType =
  | "signal_change"
  | "sweep"
  | "trace_resolve_request"
  | "trace_resolve_response"
  | "query_ask"
  | "query_respond"
  | "ack"
  | "error"
  | "permission_request"
  | "permission_verdict";
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/node/test/event-bus.test.ts`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add packages/node/src/event-bus.ts packages/node/test/event-bus.test.ts
git commit -m "feat(node): add permission_request and permission_verdict to EventBus"
```

---

### Task 3: Update WSHandlers for Permission Messages

**Files:**
- Modify: `packages/node/src/ws-handlers.ts`
- Test: `packages/node/test/ws-handlers.test.ts` (add new test cases)

**Step 1: Write the failing test**

Check if `packages/node/test/ws-handlers.test.ts` exists. If not, create it. Add tests:

```typescript
import { describe, test, expect } from "bun:test";
import { WSHandlers } from "../src/ws-handlers";
import { EventBus } from "../src/event-bus";
import type { Envelope } from "@inv/shared";

// Minimal mocks — Engine and Store not needed for permission messages
const mockEngine = {} as any;
const mockStore = {} as any;

describe("WSHandlers permission messages", () => {
  test("emits permission_request to event bus", () => {
    const bus = new EventBus();
    const handlers = new WSHandlers(mockEngine, mockStore, bus);
    let received: unknown = null;
    bus.on("permission_request", (data) => { received = data; });

    const envelope: Envelope = {
      messageId: "m1",
      fromNode: "node-a",
      toNode: "node-b",
      projectId: "proj-1",
      timestamp: new Date().toISOString(),
      payload: {
        type: "permission_request",
        requestId: "r1",
        tool: "inv_verify",
        itemId: "item-1",
      },
    };

    handlers.handle(envelope);
    expect(received).toBeTruthy();
  });

  test("emits permission_verdict to event bus", () => {
    const bus = new EventBus();
    const handlers = new WSHandlers(mockEngine, mockStore, bus);
    let received: unknown = null;
    bus.on("permission_verdict", (data) => { received = data; });

    const envelope: Envelope = {
      messageId: "m2",
      fromNode: "node-b",
      toNode: "node-a",
      projectId: "proj-1",
      timestamp: new Date().toISOString(),
      payload: {
        type: "permission_verdict",
        requestId: "r1",
        allowed: true,
      },
    };

    handlers.handle(envelope);
    expect(received).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/node/test/ws-handlers.test.ts`
Expected: Test passes the emit but the switch in `handle()` doesn't have cases for `permission_request`/`permission_verdict`, so they fall through silently. The `eventBus.emit` at line 40 will cast to `EventType` — this should still work since we added the types. Verify tests pass.

If tests already pass due to the generic `eventBus.emit(payload.type as EventType, payload)` on line 40, that's fine — the handler already forwards all message types to the EventBus. No code change needed beyond what Task 2 did.

**Step 3: Add explicit cases (optional, for logging)**

In `packages/node/src/ws-handlers.ts`, add cases in the switch before the `ack` case:

```typescript
      case "permission_request":
        // Forwarded to Claude Code via channel server's EventBus listener
        break;
      case "permission_verdict":
        // Forwarded to Claude Code via channel server's EventBus listener
        break;
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/node/test/ws-handlers.test.ts`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add packages/node/src/ws-handlers.ts packages/node/test/ws-handlers.test.ts
git commit -m "feat(node): handle permission messages in WSHandlers"
```

---

### Task 4: Install @modelcontextprotocol/sdk and Remove @anthropic-ai/sdk

**Files:**
- Modify: `packages/node/package.json`

**Step 1: Install new dependency, remove old**

```bash
cd packages/node
bun remove @anthropic-ai/sdk
bun add @modelcontextprotocol/sdk
cd ../..
```

**Step 2: Verify install**

Run: `bun install`
Expected: Clean install, no errors.

**Step 3: Commit**

```bash
git add packages/node/package.json bun.lock
git commit -m "chore(node): swap @anthropic-ai/sdk for @modelcontextprotocol/sdk"
```

---

### Task 5: Create Channel Server

This is the core task. The channel server is an MCP server that:
- Registers as a Claude Code channel (pushes events)
- Exposes inventory tools
- Relays permissions
- Bridges WebSocket to MCP

**Files:**
- Create: `packages/node/src/channel.ts`
- Test: `packages/node/test/channel.test.ts`

**Step 1: Write the failing test**

Test that the channel server can be instantiated and that tools are registered correctly. We can't easily test MCP transport in unit tests, but we can test the tool execution logic by extracting it.

```typescript
import { describe, test, expect } from "bun:test";
import { buildToolHandlers, TOOL_DEFINITIONS } from "../src/channel";

describe("channel tool definitions", () => {
  test("defines 7 tools", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(7);
  });

  test("all tools have name, description, inputSchema", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
    }
  });

  test("tool names match expected set", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name).sort();
    expect(names).toEqual([
      "inv_add_item",
      "inv_add_trace",
      "inv_ask",
      "inv_audit",
      "inv_mark_broken",
      "inv_reply",
      "inv_verify",
    ]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/node/test/channel.test.ts`
Expected: FAIL — module not found.

**Step 3: Write channel.ts**

Create `packages/node/src/channel.ts`. Fetching docs from Context7 before implementing — use `@modelcontextprotocol/sdk` patterns.

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "fs";
import { Store } from "./store";
import { StateMachine } from "./state";
import { SignalPropagator } from "./signal";
import { Engine } from "./engine";
import { EventBus } from "./event-bus";
import { WSHandlers } from "./ws-handlers";
import { WSClient } from "./ws-client";
import { loadConfig } from "./config";
import type { NodeConfig } from "./config";
import type {
  ItemKind,
  TraceRelation,
  Vertical,
  ToolArgs,
} from "@inv/shared";

// ── Tool Definitions ──────────────────────────────────────────────────

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "inv_add_item",
    description:
      "Add a new inventory item. Requires kind, title, and vertical. Optionally accepts externalRef.",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          description: "Item kind",
          enum: [
            "adr", "api-spec", "data-model", "tech-design", "epic",
            "user-story", "prd", "screen-spec", "user-flow", "test-case",
            "test-plan", "runbook", "bug-report", "decision", "custom",
          ],
        },
        title: { type: "string", description: "Title of the item" },
        body: { type: "string", description: "Optional body/description" },
        externalRef: { type: "string", description: "Optional external reference (URL or ticket ID)" },
      },
      required: ["kind", "title"],
    },
  },
  {
    name: "inv_add_trace",
    description:
      "Create a trace link between two items. Relations: traced_from, matched_by, proven_by.",
    inputSchema: {
      type: "object",
      properties: {
        fromItemId: { type: "string", description: "Source item UUID" },
        toItemId: { type: "string", description: "Target item UUID" },
        relation: {
          type: "string",
          description: "Relation type",
          enum: ["traced_from", "matched_by", "proven_by"],
        },
      },
      required: ["fromItemId", "toItemId", "relation"],
    },
  },
  {
    name: "inv_verify",
    description:
      "Verify an item (unverified→proven, suspect→proven, broke→proven). Requires evidence.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "Item UUID" },
        evidence: { type: "string", description: "Evidence for verification" },
      },
      required: ["itemId", "evidence"],
    },
  },
  {
    name: "inv_mark_broken",
    description:
      "Mark a suspect item as broken. Requires reason.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "Item UUID" },
        reason: { type: "string", description: "Reason for marking broken" },
      },
      required: ["itemId"],
    },
  },
  {
    name: "inv_audit",
    description:
      "Audit inventory health. Returns counts by state, orphans, missing upstream refs.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "inv_ask",
    description:
      "Ask a question to the inventory network. Optionally target a specific node.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask" },
        targetNode: { type: "string", description: "Optional target node UUID" },
      },
      required: ["question"],
    },
  },
  {
    name: "inv_reply",
    description:
      "Send a reply message to a specific node through the inventory network.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The reply message" },
        targetNode: { type: "string", description: "Target node UUID" },
      },
      required: ["message", "targetNode"],
    },
  },
];

// ── Tool Handler Builder ──────────────────────────────────────────────

interface ToolCallArgs {
  [key: string]: string | undefined;
}

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
}

export function buildToolHandlers(
  engine: Engine,
  config: NodeConfig,
  wsClient: WSClient | null,
): (name: string, args: ToolCallArgs) => ToolResult {
  return (name: string, args: ToolCallArgs): ToolResult => {
    const text = (s: string): ToolResult => ({
      content: [{ type: "text", text: s }],
    });

    try {
      switch (name) {
        case "inv_add_item": {
          const item = engine.addItem(
            config.node.id,
            args.kind as ItemKind,
            args.title ?? "",
            args.body,
            args.externalRef,
          );
          return text(JSON.stringify(item, null, 2));
        }

        case "inv_add_trace": {
          const trace = engine.addTrace(
            args.fromItemId ?? "",
            args.toItemId ?? "",
            args.relation as TraceRelation,
            config.node.owner,
          );
          return text(JSON.stringify(trace, null, 2));
        }

        case "inv_verify": {
          const signals = engine.verifyItem(
            args.itemId ?? "",
            args.evidence ?? "",
            config.node.owner,
          );
          return text(JSON.stringify({
            verified: true,
            itemId: args.itemId,
            signalsPropagated: signals.length,
          }, null, 2));
        }

        case "inv_mark_broken": {
          engine.markBroken(
            args.itemId ?? "",
            args.reason ?? "",
            config.node.owner,
          );
          return text(JSON.stringify({
            markedBroken: true,
            itemId: args.itemId,
          }, null, 2));
        }

        case "inv_audit": {
          const report = engine.audit(config.node.id);
          return text(JSON.stringify(report, null, 2));
        }

        case "inv_ask": {
          const question = args.question ?? "";
          const query = engine.ask(
            config.node.owner,
            config.node.id,
            question,
            undefined,
            args.targetNode,
          );

          if (wsClient?.connected) {
            if (args.targetNode) {
              wsClient.sendMessage(args.targetNode, {
                type: "query_ask",
                question,
                askerId: config.node.id,
              });
            } else {
              wsClient.broadcast({
                type: "query_ask",
                question,
                askerId: config.node.id,
              });
            }
          }

          return text(JSON.stringify({
            queryId: query.id,
            broadcast: !args.targetNode,
            networkSent: wsClient?.connected ?? false,
          }, null, 2));
        }

        case "inv_reply": {
          if (!wsClient?.connected) {
            return text(JSON.stringify({ error: "Not connected to server" }));
          }
          wsClient.sendMessage(args.targetNode ?? "", {
            type: "query_respond",
            answer: args.message ?? "",
            responderId: config.node.id,
          });
          return text(JSON.stringify({
            sent: true,
            targetNode: args.targetNode,
          }, null, 2));
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
  // 1. Load config
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const raw = readFileSync(configPath, "utf-8");
  const partial = JSON.parse(raw) as Record<string, unknown>;
  const config = loadConfig(partial);

  // 2. Create engine stack
  const store = new Store(config.database.path);
  const sm = new StateMachine();
  const propagator = new SignalPropagator(store, sm);
  const engine = new Engine(store, sm, propagator);

  // 3. Register node if needed
  if (!config.node.id) {
    const node = engine.registerNode(
      config.node.name || "unnamed-node",
      config.node.vertical,
      config.node.project || "default",
      config.node.owner || "local",
      config.node.isAI,
    );
    config.node.id = node.id;
  }

  // 4. Create EventBus, WSHandlers, WSClient
  const eventBus = new EventBus();
  const wsHandlers = new WSHandlers(engine, store, eventBus);

  let wsClient: WSClient | null = null;

  if (config.server.url && config.server.token) {
    wsClient = new WSClient({
      serverUrl: config.server.url,
      token: config.server.token,
      nodeId: config.node.id,
      projectId: config.node.project,
    });

    wsClient.onMessage((envelope) => {
      wsHandlers.handle(envelope);
    });

    try {
      await wsClient.connect();
    } catch {
      wsClient = null;
    }
  }

  // 5. Create MCP server
  const mcp = new Server(
    { name: "inventory", version: "0.1.0" },
    {
      capabilities: {
        experimental: {
          "claude/channel": {},
          "claude/channel/permission": {},
        },
        tools: {},
      },
      instructions: `You are connected to the inventory network as node "${config.node.name}" (${config.node.vertical}, project: ${config.node.project}, owner: ${config.node.owner}).

Events from the inventory network arrive as <channel source="inventory"> tags. These include:
- signal_change: an item changed state
- sweep: an external reference triggered a sweep
- query_ask: another node is asking a question
- query_respond: an answer to a previous question
- permission_request: another node needs approval for an action
- permission_verdict: approval/denial for a previous request

Use the inv_* tools to manage inventory. Reply to network messages with inv_reply.`,
    },
  );

  // 6. Register tool handlers
  const handleTool = buildToolHandlers(engine, config, wsClient);

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleTool(name, (args ?? {}) as ToolCallArgs);
  });

  // 7. Bridge EventBus → Channel notifications
  const channelEvents = [
    "signal_change",
    "sweep",
    "query_ask",
    "query_respond",
    "permission_request",
    "permission_verdict",
    "error",
  ] as const;

  for (const eventType of channelEvents) {
    eventBus.on(eventType, (data) => {
      mcp.notification({
        method: "notifications/claude/channel",
        params: {
          content: JSON.stringify(data),
          meta: { source: "inventory", eventType },
        },
      });
    });
  }

  // 8. Connect transport
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

// ── Entry Point ────────────────────────────────────────────────────────

if (import.meta.main) {
  const configPath = process.argv[2] ?? "./inv-config.json";
  startChannelServer(configPath).catch((err) => {
    console.error("Channel server fatal error:", err);
    process.exit(1);
  });
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/node/test/channel.test.ts`
Expected: All 3 tests PASS (tool definitions only — no transport needed).

**Step 5: Commit**

```bash
git add packages/node/src/channel.ts packages/node/test/channel.test.ts
git commit -m "feat(node): add MCP channel server with inventory tools and permission relay"
```

---

### Task 6: Create CLI Wizard

**Files:**
- Create: `packages/node/src/cli.ts`
- Test: `packages/node/test/cli.test.ts`

**Step 1: Write the failing test**

Test the config generation logic (not the interactive prompts):

```typescript
import { describe, test, expect } from "bun:test";
import { generateInvConfig, generateMcpConfig } from "../src/cli";
import type { Vertical } from "@inv/shared";

describe("CLI config generation", () => {
  test("generateInvConfig creates valid config", () => {
    const config = generateInvConfig({
      name: "dev-node",
      vertical: "dev" as Vertical,
      project: "clinic-checkin",
      owner: "cuong",
      serverUrl: "ws://localhost:8080/ws",
      token: "test-token",
      dbPath: "./inventory.db",
    });

    expect(config.node.name).toBe("dev-node");
    expect(config.node.vertical).toBe("dev");
    expect(config.node.project).toBe("clinic-checkin");
    expect(config.node.owner).toBe("cuong");
    expect(config.server.url).toBe("ws://localhost:8080/ws");
    expect(config.server.token).toBe("test-token");
    expect(config.database.path).toBe("./inventory.db");
  });

  test("generateMcpConfig creates valid .mcp.json structure", () => {
    const mcp = generateMcpConfig("./inv-config.json");
    expect(mcp.mcpServers.inventory.command).toBe("bun");
    expect(mcp.mcpServers.inventory.args).toContain("./inv-config.json");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/node/test/cli.test.ts`
Expected: FAIL — module not found.

**Step 3: Write cli.ts**

```typescript
import * as readline from "readline";
import { writeFileSync, existsSync } from "fs";
import type { Vertical } from "@inv/shared";

// ── Config Generators (exported for testing) ────────────────────────

interface WizardInput {
  name: string;
  vertical: Vertical;
  project: string;
  owner: string;
  serverUrl: string;
  token: string;
  dbPath: string;
}

interface InvConfig {
  node: { name: string; vertical: Vertical; project: string; owner: string };
  server: { url: string; token: string };
  database: { path: string };
}

interface McpConfig {
  mcpServers: {
    inventory: {
      command: string;
      args: string[];
    };
  };
}

export function generateInvConfig(input: WizardInput): InvConfig {
  return {
    node: {
      name: input.name,
      vertical: input.vertical,
      project: input.project,
      owner: input.owner,
    },
    server: {
      url: input.serverUrl,
      token: input.token,
    },
    database: {
      path: input.dbPath,
    },
  };
}

export function generateMcpConfig(configPath: string): McpConfig {
  return {
    mcpServers: {
      inventory: {
        command: "bun",
        args: ["run", "packages/node/src/channel.ts", configPath],
      },
    },
  };
}

// ── Interactive Wizard ───────────────────────────────────────────────

const VERTICALS: Vertical[] = ["pm", "design", "dev", "qa", "devops"];

function ask(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  const prompt = defaultValue ? `${question} (${defaultValue}): ` : `${question}: `;
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

export async function runWizard(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("");
  console.log("Inventory Node Setup");
  console.log("────────────────────");
  console.log("");

  const name = await ask(rl, "Node name");
  const verticalInput = await ask(rl, `Vertical (${VERTICALS.join("/")})`, "dev");
  if (!VERTICALS.includes(verticalInput as Vertical)) {
    console.error(`Invalid vertical: ${verticalInput}. Must be one of: ${VERTICALS.join(", ")}`);
    rl.close();
    process.exit(1);
  }
  const vertical = verticalInput as Vertical;
  const project = await ask(rl, "Project");
  const owner = await ask(rl, "Owner");

  console.log("");
  const serverUrl = await ask(rl, "Server URL", "ws://localhost:8080/ws");
  const token = await ask(rl, "Auth token");
  console.log("");
  const dbPath = await ask(rl, "Database path", "./inventory.db");

  rl.close();

  const invConfig = generateInvConfig({ name, vertical, project, owner, serverUrl, token, dbPath });
  const mcpConfig = generateMcpConfig("./inv-config.json");

  console.log("");

  const invConfigPath = "./inv-config.json";
  writeFileSync(invConfigPath, JSON.stringify(invConfig, null, 2) + "\n");
  console.log(`Writing ${invConfigPath}... ✓`);

  const mcpConfigPath = "./.mcp.json";
  writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + "\n");
  console.log(`Writing ${mcpConfigPath}... ✓`);

  console.log("");
  console.log("Setup complete! Start Claude Code:");
  console.log("  claude");
  console.log("");
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/node/test/cli.test.ts`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add packages/node/src/cli.ts packages/node/test/cli.test.ts
git commit -m "feat(node): add inv init CLI wizard"
```

---

### Task 7: Replace index.ts with CLI Router

**Files:**
- Modify: `packages/node/src/index.ts`

**Step 1: Replace index.ts**

Replace entire content of `packages/node/src/index.ts`:

```typescript
import { runWizard } from "./cli";
import { startChannelServer } from "./channel";

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === "init") {
    await runWizard();
    return;
  }

  // Default: start channel server
  // Arg can be config path, defaults to ./inv-config.json
  const configPath = command ?? "./inv-config.json";
  await startChannelServer(configPath);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

**Step 2: Verify it compiles**

Run: `bun build packages/node/src/index.ts --no-bundle --outdir /tmp/inv-check`
Expected: No TypeScript errors.

**Step 3: Commit**

```bash
git add packages/node/src/index.ts
git commit -m "feat(node): replace TUI entry point with CLI router (init + channel server)"
```

---

### Task 8: Remove Old Files

**Files:**
- Delete: `packages/node/src/agent.ts`
- Delete: `packages/node/src/tui.ts`

**Step 1: Delete agent.ts and tui.ts**

```bash
rm packages/node/src/agent.ts packages/node/src/tui.ts
```

**Step 2: Verify no remaining imports**

Search for any imports of `agent` or `tui` in the node package and remove them:

```bash
grep -rn "from.*./agent" packages/node/src/
grep -rn "from.*./tui" packages/node/src/
```

Expected: No results (index.ts no longer imports them).

**Step 3: Run all tests**

Run: `bun test packages/`
Expected: All tests pass. Any tests that imported agent.ts or tui.ts should be removed too.

**Step 4: Commit**

```bash
git add -A packages/node/src/agent.ts packages/node/src/tui.ts
git commit -m "chore(node): remove agent.ts and tui.ts (replaced by channel server)"
```

---

### Task 9: Update Root package.json Scripts

**Files:**
- Modify: `package.json` (root)

**Step 1: Update scripts**

Change the `node` script and add `init`:

```json
{
  "scripts": {
    "test": "bun test",
    "server": "bun run packages/server/src/index.ts",
    "node": "bun run packages/node/src/index.ts",
    "init": "bun run packages/node/src/index.ts init"
  }
}
```

**Step 2: Verify scripts work**

Run: `bun run init --help` (should start wizard — Ctrl+C to exit)

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add init script to root package.json"
```

---

### Task 10: Add .mcp.json and inv-config.json to .gitignore

**Files:**
- Modify: `.gitignore`

**Step 1: Add entries**

Add to `.gitignore`:

```
# Node config (contains tokens)
inv-config.json

# MCP config (generated by inv init)
.mcp.json
```

**Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore inv-config.json and .mcp.json (contain secrets)"
```

---

### Task 11: Update Progress Tracker

**Files:**
- Modify: `docs/plans/2026-03-26-typescript-rewrite-progress.md`

**Step 1: Update TODO section**

Add a "Channel Integration" section to track the new work. Mark the design as done.

**Step 2: Commit**

```bash
git add docs/plans/2026-03-26-typescript-rewrite-progress.md
git commit -m "docs: update progress tracker with channel integration status"
```

---

## Summary

| Task | What | Tests |
|------|------|-------|
| 1 | ToolArgs + permission message types in shared | 4 |
| 2 | EventBus permission events | 2 |
| 3 | WSHandlers permission handling | 2 |
| 4 | Swap dependencies | — |
| 5 | Channel server (MCP + tools + permissions + WS bridge) | 3 |
| 6 | CLI wizard (inv init) | 2 |
| 7 | Replace index.ts with CLI router | — |
| 8 | Remove agent.ts + tui.ts | — |
| 9 | Update root scripts | — |
| 10 | Gitignore secrets | — |
| 11 | Update progress tracker | — |

**Total: 11 tasks, ~13 new tests**
