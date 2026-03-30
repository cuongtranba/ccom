import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { Logger } from "./logger";
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
  {
    name: "inv_online_nodes",
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
  engine: Engine,
  config: NodeConfig,
  wsClient: WSClient | null,
): (name: string, args: ToolCallArgs) => Promise<ToolResult> {
  return async (name: string, args: ToolCallArgs): Promise<ToolResult> => {
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

          if (wsClient) {
            if (args.targetNode) {
              wsClient.sendMessage(args.targetNode, config.node.projects[0] ?? "", {
                type: "query_ask",
                question,
                askerId: config.node.id,
                queryId: query.id,
              });
            } else {
              wsClient.broadcast(config.node.projects[0] ?? "", {
                type: "query_ask",
                question,
                askerId: config.node.id,
                queryId: query.id,
              });
            }
          }

          return text(JSON.stringify({
            queryId: query.id,
            broadcast: !args.targetNode,
            networkSent: wsClient !== null,
          }, null, 2));
        }

        case "inv_reply": {
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

        case "inv_proposal_create": {
          const cr = engine.createProposal(config.node.id, config.node.owner, args.targetItemId ?? "", args.description ?? "");
          engine.submitProposal(cr.id);
          engine.openVoting(cr.id);
          let targetItemTitle = "";
          try { targetItemTitle = engine.getItem(args.targetItemId ?? "").title; } catch { /* remote item */ }
          const pendingVoters = await fetchOnlineNodes(config.server.url, config.server.token, config.node.id);
          if (wsClient?.connected) {
            wsClient.broadcast(config.node.projects[0] ?? "", {
              type: "proposal_create",
              crId: cr.id,
              targetItemId: args.targetItemId ?? "",
              description: args.description ?? "",
              proposerNode: config.node.id,
              targetItemTitle,
              proposerNodeName: config.node.name,
              pendingVoters: pendingVoters.map((n) => n.name),
            });
          }
          const waitingFor = pendingVoters.map((n) => `  waiting for ${n.name} (${n.vertical})...`).join("\n");
          return text(JSON.stringify({
            crId: cr.id,
            status: "voting",
            targetItemTitle,
            pendingVoters: pendingVoters.map((n) => ({ name: n.name, vertical: n.vertical })),
            waitingMessage: pendingVoters.length > 0
              ? `Waiting for ${pendingVoters.length} node(s) to vote:\n${waitingFor}`
              : "No other nodes online to vote.",
          }, null, 2));
        }

        case "inv_proposal_vote": {
          const nodeInfo = engine.getNode(config.node.id);
          const vote = engine.castVote(args.crId ?? "", config.node.id, nodeInfo.vertical, args.approve === "true" || args.approve === true, args.reason ?? "");
          if (wsClient?.connected) {
            wsClient.broadcast(config.node.projects[0] ?? "", {
              type: "proposal_vote",
              crId: args.crId ?? "",
              approve: vote.approve,
              reason: args.reason ?? "",
              voterNodeName: config.node.name,
            });
          }
          return text(JSON.stringify({ voted: true, crId: args.crId, approve: vote.approve }, null, 2));
        }

        case "inv_challenge_create": {
          const cr = engine.createChallenge(config.node.id, config.node.owner, args.targetItemId ?? "", args.reason ?? "");
          engine.submitProposal(cr.id);
          engine.openVoting(cr.id);
          let challengeItemTitle = "";
          try { challengeItemTitle = engine.getItem(args.targetItemId ?? "").title; } catch { /* remote item */ }
          const challengeVoters = await fetchOnlineNodes(config.server.url, config.server.token, config.node.id);
          if (wsClient?.connected) {
            wsClient.broadcast(config.node.projects[0] ?? "", {
              type: "challenge_create",
              challengeId: cr.id,
              targetItemId: args.targetItemId ?? "",
              reason: args.reason ?? "",
              challengerNode: config.node.id,
              targetItemTitle: challengeItemTitle,
              challengerNodeName: config.node.name,
              pendingVoters: challengeVoters.map((n) => n.name),
            });
          }
          const waitingFor = challengeVoters.map((n) => `  waiting for ${n.name} (${n.vertical})...`).join("\n");
          return text(JSON.stringify({
            challengeId: cr.id,
            status: "voting",
            targetItemTitle: challengeItemTitle,
            pendingVoters: challengeVoters.map((n) => ({ name: n.name, vertical: n.vertical })),
            waitingMessage: challengeVoters.length > 0
              ? `Waiting for ${challengeVoters.length} node(s) to vote:\n${waitingFor}`
              : "No other nodes online to vote.",
          }, null, 2));
        }

        case "inv_challenge_respond": {
          const nodeInfo = engine.getNode(config.node.id);
          const vote = engine.castVote(args.challengeId ?? "", config.node.id, nodeInfo.vertical, args.approve === "true" || args.approve === true, args.reason ?? "");
          if (wsClient?.connected) {
            wsClient.broadcast(config.node.projects[0] ?? "", {
              type: "proposal_vote",
              crId: args.challengeId ?? "",
              approve: vote.approve,
              reason: args.reason ?? "",
              voterNodeName: config.node.name,
            });
          }
          return text(JSON.stringify({ voted: true, challengeId: args.challengeId, approve: vote.approve }, null, 2));
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

        case "inv_online_nodes": {
          if (!config.server.url || !config.server.token) {
            return text(JSON.stringify({ error: "Not configured for network" }));
          }
          const httpUrl = config.server.url
            .replace(/^ws/, "http")
            .replace(/\/ws$/, "/api/online");
          const res = await fetch(`${httpUrl}?token=${config.server.token}`);
          if (!res.ok) {
            const err = await res.json() as { error?: string };
            return text(JSON.stringify({ error: err.error ?? `HTTP ${res.status}` }));
          }
          const data = await res.json() as {
            projects: { name: string; nodes: { nodeId: string; name: string; vertical: string }[] }[];
          };
          const lines: string[] = ["Online Nodes", ""];
          let totalNodes = 0;
          for (const proj of data.projects) {
            lines.push(`── ${proj.name} ──`);
            if (proj.nodes.length === 0) {
              lines.push("  (no other nodes online)");
            } else {
              for (const node of proj.nodes) {
                const vLabel = node.vertical ? ` (${node.vertical})` : "";
                lines.push(`  ${node.name} (${node.nodeId})${vLabel} — online`);
                totalNodes++;
              }
            }
            lines.push("");
          }
          lines.push(`Total: ${totalNodes} node${totalNodes !== 1 ? "s" : ""} online across ${data.projects.length} project${data.projects.length !== 1 ? "s" : ""}`);
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
      config.node.projects[0] || "default",
      config.node.owner || "local",
      config.node.isAI,
    );
    config.node.id = node.id;

    // Persist the node ID back to config file
    const updatedRaw = JSON.parse(readFileSync(configPath, "utf-8"));
    if (!updatedRaw.node) updatedRaw.node = {};
    updatedRaw.node.id = node.id;
    writeFileSync(configPath, JSON.stringify(updatedRaw, null, 2) + "\n");
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
      projectIds: config.node.projects,
    });

    wsClient.onMessage((envelope) => {
      wsHandlers.handle(envelope);
    });

    wsHandlers.setSendFn((toNode, payload) => {
      wsClient?.sendMessage(toNode, config.node.projects[0] ?? "", payload);
    });

    try {
      await wsClient.connect();

      // Set Claude Code status line
      try {
        const httpUrl = config.server.url
          .replace(/^ws/, "http")
          .replace(/\/ws$/, "/api/online");
        const onlineRes = await fetch(`${httpUrl}?token=${config.server.token}`);
        let onlineCount = 0;
        if (onlineRes.ok) {
          const onlineData = await onlineRes.json() as {
            projects: { nodes: { nodeId: string }[] }[];
          };
          const nodeIds = new Set<string>();
          for (const proj of onlineData.projects) {
            for (const n of proj.nodes) {
              nodeIds.add(n.nodeId);
            }
          }
          onlineCount = nodeIds.size;
        }

        const statusText = `inv: ${config.node.name} (${config.node.vertical}) · ${config.node.projects[0] ?? "no project"} · ${onlineCount} online`;
        const homedir = process.env.HOME || process.env.USERPROFILE || "~";
        const settingsPath = `${homedir}/.claude/settings.json`;
        const existingRaw = existsSync(settingsPath)
          ? JSON.parse(readFileSync(settingsPath, "utf-8"))
          : {};
        existingRaw.statusline = statusText;
        writeFileSync(settingsPath, JSON.stringify(existingRaw, null, 2) + "\n");
      } catch {
        // Non-fatal — status line is best-effort
      }
    } catch {
      // Initial connect failed — wsClient keeps retrying via internal reconnect.
      // Do NOT null wsClient here: it will reconnect and resume normal operation.
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
      instructions: `You are connected to the inventory network as node "${config.node.name}" (${config.node.vertical}, projects: ${config.node.projects.join(", ")}, owner: ${config.node.owner}).

Events from the inventory network arrive as <channel source="inventory"> tags. These include:
- signal_change: an item changed state
- sweep: an external reference triggered a sweep
- query_ask/query_respond: Q&A between nodes
- permission_request/permission_verdict: approval workflows
- proposal_create/proposal_vote/proposal_result: change request voting
- challenge_create: a node challenges an item
- checklist_update: checklist item checked/unchecked

Use the inv_* tools to manage inventory, propose changes, vote, challenge items, and manage checklists.`,
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
    "checklist_update",
    "error",
  ] as const;

  // Enrich event data with human-readable names for UUIDs where possible
  function enrichEvent(eventType: string, data: Record<string, unknown>): Record<string, unknown> {
    const enriched = { ...data };
    // Resolve item titles
    if (enriched.itemId && !enriched.itemTitle) {
      try { enriched.itemTitle = engine.getItem(enriched.itemId as string).title; } catch { /* remote item */ }
    }
    if (enriched.targetItemId && !enriched.targetItemTitle) {
      try { enriched.targetItemTitle = engine.getItem(enriched.targetItemId as string).title; } catch { /* remote item */ }
    }
    // Resolve node names
    if (enriched.fromNode && !enriched.fromNodeName) {
      try { enriched.fromNodeName = engine.getNode(enriched.fromNode as string).name; } catch { /* unknown node */ }
    }
    if (enriched.proposerNode && !enriched.proposerNodeName) {
      try { enriched.proposerNodeName = engine.getNode(enriched.proposerNode as string).name; } catch { /* unknown node */ }
    }
    if (enriched.challengerNode && !enriched.challengerNodeName) {
      try { enriched.challengerNodeName = engine.getNode(enriched.challengerNode as string).name; } catch { /* unknown node */ }
    }
    if (enriched.responderId && !enriched.responderName) {
      try { enriched.responderName = engine.getNode(enriched.responderId as string).name; } catch { /* unknown node */ }
    }
    if (enriched.askerId && !enriched.askerName) {
      try { enriched.askerName = engine.getNode(enriched.askerId as string).name; } catch { /* unknown node */ }
    }
    return enriched;
  }

  const log = new Logger("channel-bridge");
  for (const eventType of channelEvents) {
    eventBus.on(eventType, (data) => {
      const enriched = enrichEvent(eventType, data as Record<string, unknown>);
      mcp.notification({
        method: "notifications/claude/channel",
        params: {
          content: JSON.stringify(enriched),
          meta: { source: "inventory", eventType },
        },
      } as Parameters<typeof mcp.notification>[0]).catch((err) => {
        log.error("Failed to send channel notification", {
          eventType,
          error: err instanceof Error ? err.message : String(err),
        });
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
  const log = new Logger("channel-server");
  startChannelServer(configPath).catch((err) => {
    log.error("Channel server fatal error", { error: String(err) });
    process.exit(1);
  });
}
