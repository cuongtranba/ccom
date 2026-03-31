import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "fs";
import { Logger } from "./logger";
import { EventBus, EventType } from "./event-bus";
import { WSHandlers } from "./ws-handlers";
import { WSClient } from "./ws-client";
import { loadConfig } from "./config";
import type { NodeConfig } from "./config";

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
    name: "ccom_ask",
    description:
      "Ask a question to the ccom network. Broadcasts to all nodes or targets a specific node.",
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
    name: "ccom_reply",
    description:
      "Reply to a question from another node. Use this when you receive a query_ask event and want to send your answer back.",
    inputSchema: {
      type: "object",
      properties: {
        answer: { type: "string", description: "The answer to the question" },
        targetNode: { type: "string", description: "Target node name or UUID" },
        queryId: { type: "string", description: "Optional query UUID this reply is in response to (for correlation)" },
      },
      required: ["answer", "targetNode"],
    },
  },
  {
    name: "ccom_online_nodes",
    description:
      "List all other nodes currently online in this project. Use this to discover who you can communicate with.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// ── Online Nodes Helper ───────────────────────────────────────────────

interface OnlineNode {
  nodeId: string;
  name: string;
  vertical: string;
}

async function fetchOnlineNodes(
  serverUrl: string,
  token: string,
  excludeNodeId?: string,
): Promise<OnlineNode[]> {
  try {
    const httpUrl = serverUrl
      .replace(/^ws/, "http")
      .replace(/\/ws$/, "/api/online");
    const res = await fetch(`${httpUrl}?token=${token}`);
    if (!res.ok) return [];
    const data = await res.json() as {
      projects: { nodes: { nodeId: string; name: string; vertical: string }[] }[];
    };
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

// ── Tool Handler Builder ──────────────────────────────────────────────

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
    const text = (s: string): ToolResult => ({
      content: [{ type: "text", text: s }],
    });

    try {
      switch (name) {
        case "ccom_ask": {
          const question = args.question ?? "";
          const queryId = crypto.randomUUID();

          if (wsClient) {
            if (args.targetNode) {
              wsClient.sendMessage(args.targetNode, config.node.projects[0] ?? "", {
                type: "query_ask",
                question,
                askerId: config.node.id,
                queryId,
              });
            } else {
              wsClient.broadcast(config.node.projects[0] ?? "", {
                type: "query_ask",
                question,
                askerId: config.node.id,
                queryId,
              });
            }
          }

          return text(JSON.stringify({
            queryId,
            broadcast: !args.targetNode,
            networkSent: wsClient !== null,
          }, null, 2));
        }

        case "ccom_reply": {
          if (!wsClient) {
            return text(JSON.stringify({ error: "Not connected to server" }));
          }
          const answer = args.answer ?? "";
          if (!answer) {
            return text(JSON.stringify({ error: "Answer cannot be empty" }));
          }
          wsClient.sendMessage(args.targetNode ?? "", config.node.projects[0] ?? "", {
            type: "query_respond",
            answer,
            responderId: config.node.id,
            ...(args.queryId ? { replyTo: args.queryId } : {}),
          });
          return text(JSON.stringify({
            sent: true,
            targetNode: args.targetNode,
          }, null, 2));
        }

        case "ccom_online_nodes": {
          if (!config.server.url || !config.server.token) {
            return text(JSON.stringify({ error: "Not configured for network" }));
          }
          const nodes = await fetchOnlineNodes(config.server.url, config.server.token, config.node.id);
          if (nodes.length === 0) {
            return text("No other nodes online.");
          }
          return text(JSON.stringify(nodes, null, 2));
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

  // 2. Create EventBus and WSHandlers — NO store, NO engine
  const eventBus = new EventBus();
  const wsHandlers = new WSHandlers(eventBus);

  // 3. Create WSClient if server config present
  let wsClient: WSClient | null = null;

  if (config.server.url && config.server.token) {
    wsClient = new WSClient({
      serverUrl: config.server.url,
      token: config.server.token,
      nodeId: config.node.id,
      projectIds: config.node.projects,
    });

    wsClient.onMessage((envelope) => {
      wsHandlers.handle(envelope);
    });

    try {
      await wsClient.connect();
    } catch {
      // Initial connect failed — wsClient keeps retrying via internal reconnect.
    }
  }

  // 4. Create MCP server
  const mcp = new Server(
    { name: "ccom", version: "0.1.0" },
    {
      capabilities: {
        experimental: {
          "claude/channel": {},
          "claude/channel/permission": {},
        },
        tools: {},
      },
      instructions: `You are connected to the ccom network as node "${config.node.name}" (${config.node.vertical}, projects: ${config.node.projects.join(", ")}, owner: ${config.node.owner}).

Events from the ccom network arrive as <channel source="ccom"> tags. These include:
- query_ask: another node is asking a question
- query_respond: a node replied to a question
- ack: acknowledgement of a sent message
- error: an error from the network

Use the ccom_ask, ccom_reply, and ccom_online_nodes tools to communicate with other nodes.`,
    },
  );

  // 5. Register tool handlers
  const handleTool = buildToolHandlers(config, wsClient);

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleTool(name, (args ?? {}) as ToolCallArgs);
  });

  // 6. Bridge EventBus → Channel notifications
  const log = new Logger("channel-bridge");
  const eventTypes: EventType[] = ["query_ask", "query_respond", "ack", "error"];

  for (const eventType of eventTypes) {
    eventBus.on(eventType, (data) => {
      mcp.notification({
        method: "notifications/claude/channel",
        params: {
          content: JSON.stringify(data),
          meta: { source: "ccom", eventType },
        },
      } as Parameters<typeof mcp.notification>[0]).catch((err) => {
        log.error("Failed to send channel notification", {
          eventType,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });
  }

  // 7. Connect transport
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

// ── Entry Point ────────────────────────────────────────────────────────

if (import.meta.main) {
  const configPath = process.argv[2] ?? "./inv-config.json";
  const log = new Logger("channel-server");
  startChannelServer(configPath).catch((err) => {
    log.error("Channel server fatal error", { error: String(err) });
    process.exit(1);
  });
}
