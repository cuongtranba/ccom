import { describe, it, expect, beforeEach } from "bun:test";
import { EventBus } from "../src/event-bus";
import { WSHandlers } from "../src/ws-handlers";
import { createEnvelope, type Envelope, type MessagePayload } from "@inv/shared";

// ── Local Message Router ────────────────────────────────────────────────
// Simulates the central WebSocket server in-process.
// Each node registers with the router. Messages are delivered synchronously.

interface NodeConnection {
  nodeId: string;
  projectId: string;
  onMessage: (envelope: Envelope) => void;
}

class LocalRouter {
  private connections = new Map<string, NodeConnection>();

  register(conn: NodeConnection): void {
    this.connections.set(conn.nodeId, conn);
  }

  unregister(nodeId: string): void {
    this.connections.delete(nodeId);
  }

  /** Route an envelope: direct if toNode is set, broadcast otherwise. */
  route(envelope: Envelope): void {
    if (envelope.toNode) {
      const conn = this.connections.get(envelope.toNode);
      if (conn) {
        conn.onMessage(envelope);
      }
    } else {
      for (const conn of this.connections.values()) {
        if (conn.nodeId !== envelope.fromNode && conn.projectId === envelope.projectId) {
          conn.onMessage(envelope);
        }
      }
    }
  }
}

// ── Simulated Node ──────────────────────────────────────────────────────

interface SimNode {
  nodeId: string;
  projectId: string;
  eventBus: EventBus;
  wsHandlers: WSHandlers;
  events: Array<{ type: string; data: unknown }>;
  send: (toNode: string, payload: MessagePayload) => void;
  broadcast: (payload: MessagePayload) => void;
}

function createSimNode(
  router: LocalRouter,
  nodeId: string,
  projectId: string,
): SimNode {
  const eventBus = new EventBus();
  const wsHandlers = new WSHandlers(eventBus);
  const events: Array<{ type: string; data: unknown }> = [];

  const eventTypes = ["query_ask", "query_respond", "ack", "error"] as const;
  for (const type of eventTypes) {
    eventBus.on(type, (data) => {
      events.push({ type, data });
    });
  }

  router.register({
    nodeId,
    projectId,
    onMessage: (envelope) => wsHandlers.handle(envelope),
  });

  const send = (toNode: string, payload: MessagePayload): void => {
    const envelope = createEnvelope(nodeId, toNode, projectId, payload);
    router.route(envelope);
  };

  const broadcast = (payload: MessagePayload): void => {
    const envelope = createEnvelope(nodeId, "", projectId, payload);
    router.route(envelope);
  };

  return { nodeId, projectId, eventBus, wsHandlers, events, send, broadcast };
}

// ── Tests ───────────────────────────────────────────────────────────────

const PROJECT = "clinic-checkin";

describe("E2E Multi-Node: 5 Claude Code sessions communicating", () => {
  let router: LocalRouter;
  let pm: SimNode;
  let design: SimNode;
  let dev: SimNode;
  let qa: SimNode;
  let devops: SimNode;

  beforeEach(() => {
    router = new LocalRouter();
    pm     = createSimNode(router, "pm-node",     PROJECT);
    design = createSimNode(router, "design-node", PROJECT);
    dev    = createSimNode(router, "dev-node",    PROJECT);
    qa     = createSimNode(router, "qa-node",     PROJECT);
    devops = createSimNode(router, "devops-node", PROJECT);
  });

  // ── Direct messaging ─────────────────────────────────────────────────

  describe("Direct messaging between nodes", () => {
    it("Dev sends query_ask to QA only, others don't receive it", () => {
      dev.send(qa.nodeId, {
        type: "query_ask",
        question: "Did the test pass?",
        askerId: dev.nodeId,
      });

      expect(qa.events.filter((e) => e.type === "query_ask")).toHaveLength(1);
      expect(pm.events.filter((e) => e.type === "query_ask")).toHaveLength(0);
      expect(design.events.filter((e) => e.type === "query_ask")).toHaveLength(0);
      expect(devops.events.filter((e) => e.type === "query_ask")).toHaveLength(0);
    });

    it("Dev asks PM, PM replies with query_respond", () => {
      dev.send(pm.nodeId, {
        type: "query_ask",
        question: "What is the expected QR format?",
        askerId: dev.nodeId,
      });

      expect(pm.events.filter((e) => e.type === "query_ask")).toHaveLength(1);

      pm.send(dev.nodeId, {
        type: "query_respond",
        answer: "Base64-encoded appointment UUID",
        responderId: pm.nodeId,
      });

      const devAnswers = dev.events.filter((e) => e.type === "query_respond");
      expect(devAnswers).toHaveLength(1);
      const data = devAnswers[0].data as { answer: string };
      expect(data.answer).toBe("Base64-encoded appointment UUID");
    });

    it("Dev sends error to PM", () => {
      dev.send(pm.nodeId, {
        type: "error",
        code: "ITEM_NOT_FOUND",
        message: "Cannot resolve trace: item does not exist on dev node",
      });

      const pmErrors = pm.events.filter((e) => e.type === "error");
      expect(pmErrors).toHaveLength(1);
      const data = pmErrors[0].data as { code: string };
      expect(data.code).toBe("ITEM_NOT_FOUND");
    });

    it("ack is delivered to the target node only", () => {
      qa.send(dev.nodeId, {
        type: "ack",
        originalMessageId: "msg-abc",
      });

      expect(dev.events.filter((e) => e.type === "ack")).toHaveLength(1);
      expect(pm.events.filter((e) => e.type === "ack")).toHaveLength(0);
    });
  });

  // ── Broadcast messaging ───────────────────────────────────────────────

  describe("Broadcast messaging", () => {
    it("PM broadcasts query_ask, all other nodes receive it", () => {
      pm.broadcast({
        type: "query_ask",
        question: "Is everyone ready for the demo?",
        askerId: pm.nodeId,
      });

      expect(design.events.filter((e) => e.type === "query_ask")).toHaveLength(1);
      expect(dev.events.filter((e) => e.type === "query_ask")).toHaveLength(1);
      expect(qa.events.filter((e) => e.type === "query_ask")).toHaveLength(1);
      expect(devops.events.filter((e) => e.type === "query_ask")).toHaveLength(1);

      // Sender does NOT receive its own broadcast
      expect(pm.events.filter((e) => e.type === "query_ask")).toHaveLength(0);
    });

    it("QA broadcasts question, Dev and DevOps can both respond", () => {
      qa.broadcast({
        type: "query_ask",
        question: "Anyone seen intermittent 500s on /check-in?",
        askerId: qa.nodeId,
      });

      dev.send(qa.nodeId, {
        type: "query_respond",
        answer: "Yes, race condition in queue handler",
        responderId: dev.nodeId,
      });

      devops.send(qa.nodeId, {
        type: "query_respond",
        answer: "Confirmed in monitoring",
        responderId: devops.nodeId,
      });

      expect(qa.events.filter((e) => e.type === "query_respond")).toHaveLength(2);
    });

    it("broadcast does not echo back to sender", () => {
      dev.broadcast({
        type: "query_ask",
        question: "Are we good?",
        askerId: dev.nodeId,
      });

      expect(dev.events.filter((e) => e.type === "query_ask")).toHaveLength(0);
    });
  });

  // ── Node offline / reconnect ──────────────────────────────────────────

  describe("Node goes offline and misses messages", () => {
    it("offline node does not receive broadcasts", () => {
      router.unregister(qa.nodeId);

      pm.broadcast({
        type: "query_ask",
        question: "Status update?",
        askerId: pm.nodeId,
      });

      expect(qa.events.filter((e) => e.type === "query_ask")).toHaveLength(0);
      expect(dev.events.filter((e) => e.type === "query_ask")).toHaveLength(1);
      expect(design.events.filter((e) => e.type === "query_ask")).toHaveLength(1);
    });

    it("direct message to offline node is dropped", () => {
      router.unregister(dev.nodeId);

      pm.send(dev.nodeId, {
        type: "query_ask",
        question: "Are you there?",
        askerId: pm.nodeId,
      });

      expect(dev.events.filter((e) => e.type === "query_ask")).toHaveLength(0);
    });

    it("node reconnects and receives new messages", () => {
      router.unregister(qa.nodeId);

      pm.broadcast({
        type: "query_ask",
        question: "First broadcast",
        askerId: pm.nodeId,
      });

      expect(qa.events.filter((e) => e.type === "query_ask")).toHaveLength(0);

      // QA reconnects
      router.register({
        nodeId: qa.nodeId,
        projectId: PROJECT,
        onMessage: (envelope) => qa.wsHandlers.handle(envelope),
      });

      pm.broadcast({
        type: "query_ask",
        question: "Second broadcast after reconnect",
        askerId: pm.nodeId,
      });

      expect(qa.events.filter((e) => e.type === "query_ask")).toHaveLength(1);
    });
  });

  // ── Project isolation ─────────────────────────────────────────────────

  describe("Project isolation", () => {
    it("messages from different projects are not received", () => {
      const otherNode = createSimNode(router, "other-pm", "other-project");

      // Register other-pm explicitly on the shared router with a different project
      // (createSimNode already does this, so the node is connected)

      pm.broadcast({
        type: "query_ask",
        question: "In clinic-checkin project",
        askerId: pm.nodeId,
      });

      // other-pm is on a different project — should NOT receive it
      expect(otherNode.events.filter((e) => e.type === "query_ask")).toHaveLength(0);

      // Same-project nodes still receive it
      expect(dev.events.filter((e) => e.type === "query_ask")).toHaveLength(1);
    });
  });

  // ── Multi-message exchange ────────────────────────────────────────────

  describe("Multi-message exchange across nodes", () => {
    it("all 4 message types can be exchanged between any pair of nodes", () => {
      // query_ask
      pm.send(dev.nodeId, { type: "query_ask", question: "Q?", askerId: pm.nodeId });
      expect(dev.events.filter((e) => e.type === "query_ask")).toHaveLength(1);

      // query_respond
      dev.send(pm.nodeId, { type: "query_respond", answer: "A.", responderId: dev.nodeId });
      expect(pm.events.filter((e) => e.type === "query_respond")).toHaveLength(1);

      // ack
      pm.send(dev.nodeId, { type: "ack", originalMessageId: "msg-1" });
      expect(dev.events.filter((e) => e.type === "ack")).toHaveLength(1);

      // error
      dev.send(pm.nodeId, { type: "error", code: "ERR", message: "something failed" });
      expect(pm.events.filter((e) => e.type === "error")).toHaveLength(1);
    });
  });
});
