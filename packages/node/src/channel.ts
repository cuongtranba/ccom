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
      "Add a new inventory item. Requires kind and title. Optionally accepts body and externalRef.",
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
      } as Parameters<typeof mcp.notification>[0]);
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
