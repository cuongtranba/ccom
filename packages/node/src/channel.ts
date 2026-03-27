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
  {
    name: "inv_proposal_create",
    description: "Create a change request proposal for an item. Starts as draft, submits, and opens for voting.",
    inputSchema: {
      type: "object",
      properties: {
        targetItemId: { type: "string", description: "Item UUID to propose changes for" },
        description: { type: "string", description: "Description of the proposed change" },
      },
      required: ["targetItemId", "description"],
    },
  },
  {
    name: "inv_proposal_vote",
    description: "Vote on a proposal that is in voting status.",
    inputSchema: {
      type: "object",
      properties: {
        crId: { type: "string", description: "Change request UUID" },
        approve: { type: "boolean", description: "true to approve, false to reject" },
        reason: { type: "string", description: "Reason for your vote" },
      },
      required: ["crId", "approve", "reason"],
    },
  },
  {
    name: "inv_challenge_create",
    description: "Challenge a proven item. Creates a CR that goes through voting. If upheld, item becomes suspect.",
    inputSchema: {
      type: "object",
      properties: {
        targetItemId: { type: "string", description: "Item UUID to challenge" },
        reason: { type: "string", description: "Reason for the challenge" },
      },
      required: ["targetItemId", "reason"],
    },
  },
  {
    name: "inv_challenge_respond",
    description: "Vote on an active challenge.",
    inputSchema: {
      type: "object",
      properties: {
        challengeId: { type: "string", description: "Challenge (CR) UUID" },
        approve: { type: "boolean", description: "true to uphold challenge, false to dismiss" },
        reason: { type: "string", description: "Reason" },
      },
      required: ["challengeId", "approve", "reason"],
    },
  },
  {
    name: "inv_pair_invite",
    description: "Invite another node to a pairing session.",
    inputSchema: {
      type: "object",
      properties: {
        targetNode: { type: "string", description: "Target node UUID to pair with" },
      },
      required: ["targetNode"],
    },
  },
  {
    name: "inv_pair_join",
    description: "Accept a pending pairing session invitation.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Pair session UUID" },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "inv_pair_end",
    description: "End an active pairing session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Pair session UUID" },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "inv_pair_list",
    description: "List active pairing sessions for this node.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "inv_checklist_add",
    description: "Add a checklist item to an inventory item.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "Parent inventory item UUID" },
        text: { type: "string", description: "Checklist item text" },
      },
      required: ["itemId", "text"],
    },
  },
  {
    name: "inv_checklist_check",
    description: "Mark a checklist item as checked.",
    inputSchema: {
      type: "object",
      properties: {
        checklistItemId: { type: "string", description: "Checklist item UUID" },
      },
      required: ["checklistItemId"],
    },
  },
  {
    name: "inv_checklist_uncheck",
    description: "Uncheck a checklist item.",
    inputSchema: {
      type: "object",
      properties: {
        checklistItemId: { type: "string", description: "Checklist item UUID" },
      },
      required: ["checklistItemId"],
    },
  },
  {
    name: "inv_checklist_list",
    description: "List all checklist items for an inventory item.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "Parent inventory item UUID" },
      },
      required: ["itemId"],
    },
  },
];

// ── Tool Handler Builder ──────────────────────────────────────────────

interface ToolCallArgs {
  [key: string]: string | boolean | undefined;
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

        case "inv_proposal_create": {
          const cr = engine.createProposal(config.node.id, config.node.owner, args.targetItemId ?? "", args.description ?? "");
          engine.submitProposal(cr.id);
          engine.openVoting(cr.id);
          if (wsClient?.connected) {
            wsClient.broadcast({
              type: "proposal_create",
              crId: cr.id,
              targetItemId: args.targetItemId ?? "",
              description: args.description ?? "",
              proposerNode: config.node.id,
            });
          }
          return text(JSON.stringify({ crId: cr.id, status: "voting" }, null, 2));
        }

        case "inv_proposal_vote": {
          const nodeInfo = engine.getNode(config.node.id);
          const vote = engine.castVote(args.crId ?? "", config.node.id, nodeInfo.vertical, args.approve === "true" || args.approve === true, args.reason ?? "");
          if (wsClient?.connected) {
            wsClient.broadcast({
              type: "proposal_vote",
              crId: args.crId ?? "",
              approve: vote.approve,
              reason: args.reason ?? "",
            });
          }
          return text(JSON.stringify({ voted: true, crId: args.crId, approve: vote.approve }, null, 2));
        }

        case "inv_challenge_create": {
          const cr = engine.createChallenge(config.node.id, config.node.owner, args.targetItemId ?? "", args.reason ?? "");
          engine.submitProposal(cr.id);
          engine.openVoting(cr.id);
          if (wsClient?.connected) {
            wsClient.broadcast({
              type: "challenge_create",
              challengeId: cr.id,
              targetItemId: args.targetItemId ?? "",
              reason: args.reason ?? "",
              challengerNode: config.node.id,
            });
          }
          return text(JSON.stringify({ challengeId: cr.id, status: "voting" }, null, 2));
        }

        case "inv_challenge_respond": {
          const nodeInfo = engine.getNode(config.node.id);
          const vote = engine.castVote(args.challengeId ?? "", config.node.id, nodeInfo.vertical, args.approve === "true" || args.approve === true, args.reason ?? "");
          if (wsClient?.connected) {
            wsClient.broadcast({
              type: "proposal_vote",
              crId: args.challengeId ?? "",
              approve: vote.approve,
              reason: args.reason ?? "",
            });
          }
          return text(JSON.stringify({ voted: true, challengeId: args.challengeId, approve: vote.approve }, null, 2));
        }

        case "inv_pair_invite": {
          const session = engine.invitePair(config.node.id, args.targetNode ?? "", config.node.project);
          if (wsClient?.connected) {
            wsClient.sendMessage(args.targetNode ?? "", {
              type: "pair_invite",
              sessionId: session.id,
              initiatorNode: config.node.id,
            });
          }
          return text(JSON.stringify({ sessionId: session.id, status: "pending" }, null, 2));
        }

        case "inv_pair_join": {
          const session = engine.joinPair(args.sessionId ?? "");
          if (wsClient?.connected) {
            wsClient.sendMessage(session.initiatorNode, {
              type: "pair_respond",
              sessionId: session.id,
              accepted: true,
            });
          }
          return text(JSON.stringify({ sessionId: session.id, status: "active" }, null, 2));
        }

        case "inv_pair_end": {
          const session = engine.endPair(args.sessionId ?? "");
          if (wsClient?.connected) {
            const partner = session.initiatorNode === config.node.id ? session.partnerNode : session.initiatorNode;
            wsClient.sendMessage(partner, {
              type: "pair_end",
              sessionId: session.id,
            });
          }
          return text(JSON.stringify({ sessionId: session.id, status: "ended" }, null, 2));
        }

        case "inv_pair_list": {
          const sessions = engine.listPairSessions(config.node.id);
          return text(JSON.stringify(sessions, null, 2));
        }

        case "inv_checklist_add": {
          const cl = engine.addChecklistItem(args.itemId ?? "", args.text ?? "");
          return text(JSON.stringify(cl, null, 2));
        }

        case "inv_checklist_check": {
          engine.checkChecklistItem(args.checklistItemId ?? "");
          return text(JSON.stringify({ checked: true, checklistItemId: args.checklistItemId }, null, 2));
        }

        case "inv_checklist_uncheck": {
          engine.uncheckChecklistItem(args.checklistItemId ?? "");
          return text(JSON.stringify({ unchecked: true, checklistItemId: args.checklistItemId }, null, 2));
        }

        case "inv_checklist_list": {
          const items = engine.listChecklist(args.itemId ?? "");
          return text(JSON.stringify(items, null, 2));
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
- query_ask/query_respond: Q&A between nodes
- permission_request/permission_verdict: approval workflows
- proposal_create/proposal_vote/proposal_result: change request voting
- challenge_create: a node challenges an item
- pair_invite/pair_respond/pair_end: pairing session events
- checklist_update: checklist item checked/unchecked

Use the inv_* tools to manage inventory, propose changes, vote, challenge items, pair with other nodes, and manage checklists.`,
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
    "proposal_create",
    "proposal_vote",
    "proposal_result",
    "challenge_create",
    "pair_invite",
    "pair_respond",
    "pair_end",
    "checklist_update",
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
