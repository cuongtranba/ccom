import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Store } from "../src/store";
import { StateMachine } from "../src/state";
import { SignalPropagator } from "../src/signal";
import { Engine } from "../src/engine";
import { EventBus } from "../src/event-bus";
import { WSHandlers } from "../src/ws-handlers";
import {
  createEnvelope,
  type Envelope,
  type MessagePayload,
} from "@inv/shared";
import type { Node, Item, Vertical } from "@inv/shared";

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
      // Direct message
      const conn = this.connections.get(envelope.toNode);
      if (conn) {
        conn.onMessage(envelope);
      }
      // If offline, message is dropped (no outbox in test)
    } else {
      // Broadcast to all in same project except sender
      for (const conn of this.connections.values()) {
        if (conn.nodeId !== envelope.fromNode && conn.projectId === envelope.projectId) {
          conn.onMessage(envelope);
        }
      }
    }
  }
}

// ── Simulated Node ──────────────────────────────────────────────────────
// Each SimNode represents a separate Claude Code session with its own
// Store, Engine, EventBus — completely isolated from other nodes.

interface SimNode {
  node: Node;
  store: Store;
  engine: Engine;
  eventBus: EventBus;
  wsHandlers: WSHandlers;
  events: Array<{ type: string; data: unknown }>;
  send: (toNode: string, payload: MessagePayload) => void;
  broadcast: (payload: MessagePayload) => void;
}

function createSimNode(
  router: LocalRouter,
  name: string,
  vertical: Vertical,
  project: string,
  owner: string,
): SimNode {
  const store = new Store(":memory:");
  const sm = new StateMachine();
  const propagator = new SignalPropagator(store, sm);
  const engine = new Engine(store, sm, propagator);
  const eventBus = new EventBus();
  const wsHandlers = new WSHandlers(engine, store, eventBus);
  const events: Array<{ type: string; data: unknown }> = [];

  const node = engine.registerNode(name, vertical, project, owner, false);

  // Subscribe to all event types to track what happened
  const eventTypes = [
    "signal_change", "sweep", "trace_resolve_request", "trace_resolve_response",
    "query_ask", "query_respond", "ack", "error",
  ] as const;
  for (const type of eventTypes) {
    eventBus.on(type, (data) => {
      events.push({ type, data });
    });
  }

  // Register with router (simulates WSClient connection)
  router.register({
    nodeId: node.id,
    projectId: project,
    onMessage: (envelope) => {
      wsHandlers.handle(envelope);
    },
  });

  // Helper to send messages through the router
  const send = (toNode: string, payload: MessagePayload): void => {
    const envelope = createEnvelope(node.id, toNode, project, payload);
    router.route(envelope);
  };

  const broadcast = (payload: MessagePayload): void => {
    const envelope = createEnvelope(node.id, "", project, payload);
    router.route(envelope);
  };

  // Wire up auto-response so handlers can send replies back through the router
  wsHandlers.setSendFn((toNode, payload) => {
    send(toNode, payload);
  });

  return { node, store, engine, eventBus, wsHandlers, events, send, broadcast };
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
    pm = createSimNode(router, "pm-node", "pm", PROJECT, "alice");
    design = createSimNode(router, "design-node", "design", PROJECT, "bob");
    dev = createSimNode(router, "dev-node", "dev", PROJECT, "cuong");
    qa = createSimNode(router, "qa-node", "qa", PROJECT, "diana");
    devops = createSimNode(router, "devops-node", "devops", PROJECT, "eve");
  });

  afterEach(() => {
    pm.store.close();
    design.store.close();
    dev.store.close();
    qa.store.close();
    devops.store.close();
  });

  // ── Signal Broadcasting ───────────────────────────────────────────────

  describe("Signal broadcasting across nodes", () => {
    it("PM broadcasts signal_change, all other nodes receive it", () => {
      pm.broadcast({
        type: "signal_change",
        itemId: "item-001",
        oldState: "proven",
        newState: "suspect",
      });

      // All 4 other nodes should have received the event
      expect(design.events.filter((e) => e.type === "signal_change")).toHaveLength(1);
      expect(dev.events.filter((e) => e.type === "signal_change")).toHaveLength(1);
      expect(qa.events.filter((e) => e.type === "signal_change")).toHaveLength(1);
      expect(devops.events.filter((e) => e.type === "signal_change")).toHaveLength(1);

      // PM should NOT receive its own broadcast
      expect(pm.events.filter((e) => e.type === "signal_change")).toHaveLength(0);
    });

    it("Dev sends direct message to QA only", () => {
      dev.send(qa.node.id, {
        type: "query_ask",
        question: "Did the test pass?",
        askerId: dev.node.id,
      });

      // Only QA receives it
      expect(qa.events.filter((e) => e.type === "query_ask")).toHaveLength(1);

      // Others don't
      expect(pm.events.filter((e) => e.type === "query_ask")).toHaveLength(0);
      expect(design.events.filter((e) => e.type === "query_ask")).toHaveLength(0);
      expect(devops.events.filter((e) => e.type === "query_ask")).toHaveLength(0);
    });

    it("broadcast does not echo back to sender", () => {
      dev.broadcast({
        type: "sweep",
        externalRef: "JIRA-500",
        newValue: "updated",
      });

      expect(dev.events.filter((e) => e.type === "sweep")).toHaveLength(0);
    });
  });

  // ── Cross-Node Query/Response ─────────────────────────────────────────

  describe("Cross-node query and response", () => {
    it("Dev asks PM a question, PM receives it and can reply", () => {
      // Dev asks PM
      dev.send(pm.node.id, {
        type: "query_ask",
        question: "What is the expected QR format?",
        askerId: dev.node.id,
      });

      // PM receives the question via channel (no auto-respond)
      const pmQuestions = pm.events.filter((e) => e.type === "query_ask");
      expect(pmQuestions).toHaveLength(1);

      // No auto-response — Claude handles replies via inv_reply
      const devAutoAnswers = dev.events.filter((e) => e.type === "query_respond");
      expect(devAutoAnswers).toHaveLength(0);

      // PM sends a manual response
      pm.send(dev.node.id, {
        type: "query_respond",
        answer: "Base64-encoded appointment UUID",
        responderId: pm.node.id,
      });

      // Dev receives PM's manual response
      const devAllAnswers = dev.events.filter((e) => e.type === "query_respond");
      expect(devAllAnswers).toHaveLength(1);
    });

    it("QA broadcasts question, all nodes receive it", () => {
      qa.broadcast({
        type: "query_ask",
        question: "Anyone seen intermittent 500s on /check-in?",
        askerId: qa.node.id,
      });

      // All nodes receive the question via channel
      expect(pm.events.filter((e) => e.type === "query_ask")).toHaveLength(1);
      expect(design.events.filter((e) => e.type === "query_ask")).toHaveLength(1);
      expect(dev.events.filter((e) => e.type === "query_ask")).toHaveLength(1);
      expect(devops.events.filter((e) => e.type === "query_ask")).toHaveLength(1);

      // No auto-responses — Claude on each node handles replies
      const qaAutoAnswers = qa.events.filter((e) => e.type === "query_respond");
      expect(qaAutoAnswers).toHaveLength(0);

      // Dev and DevOps send manual responses
      dev.send(qa.node.id, {
        type: "query_respond",
        answer: "Yes, it's a known race condition in the queue handler",
        responderId: dev.node.id,
      });

      devops.send(qa.node.id, {
        type: "query_respond",
        answer: "Confirmed in monitoring — spike at 14:00 UTC daily",
        responderId: devops.node.id,
      });

      // QA receives 2 manual responses
      const qaAllAnswers = qa.events.filter((e) => e.type === "query_respond");
      expect(qaAllAnswers).toHaveLength(2);
    });
  });

  // ── Cross-Node Item Sync + Signal Cascade ─────────────────────────────

  describe("Cross-node: PM change cascades to Dev via network", () => {
    it("PM creates item, Dev mirrors it locally, PM change signals Dev", () => {
      // PM creates and verifies a PRD on PM's node
      const prd = pm.engine.addItem(pm.node.id, "prd", "Check-In PRD", "", "JIRA-101");
      pm.engine.verifyItem(prd.id, "Approved", "alice");

      // Dev creates a local API spec and traces it from PM's PRD
      // In real system, Dev would need PM's item synced locally.
      // Dev registers PM's node locally so traces can reference it.
      dev.store.createNode({
        name: pm.node.name,
        vertical: pm.node.vertical,
        project: pm.node.project,
        owner: pm.node.owner,
        isAI: false,
      });

      // Dev creates local proxy of PM's item for trace purposes
      // (In V2, items would sync automatically via the channel server)
      const prdProxy = dev.store.createItem({
        nodeId: dev.node.id, // stored locally under dev's node for now
        kind: "prd",
        title: "Check-In PRD (ref)",
        externalRef: "JIRA-101",
      });
      dev.store.updateItemStatus(prdProxy.id, "proven", "Synced from PM", "sync");

      const apiSpec = dev.engine.addItem(dev.node.id, "api-spec", "Check-In API", "", "");
      dev.engine.verifyItem(apiSpec.id, "Code reviewed", "cuong");
      dev.engine.addTrace(apiSpec.id, prdProxy.id, "traced_from", "cuong");

      // PM broadcasts that the PRD changed
      pm.broadcast({
        type: "signal_change",
        itemId: prd.id,
        oldState: "proven",
        newState: "suspect",
      });

      // Dev receives the signal
      const devSignals = dev.events.filter((e) => e.type === "signal_change");
      expect(devSignals).toHaveLength(1);

      // Dev's WSHandlers tried to propagate locally using the remote itemId.
      // In real system, the channel server would map remote → local proxy.
      // For now, Dev manually propagates from the proxy item:
      const localSignals = dev.engine.propagateChange(prdProxy.id);
      expect(localSignals).toHaveLength(1);
      expect(dev.engine.getItem(apiSpec.id).state).toBe("suspect");
    });
  });

  // ── Full Multi-Node Workflow ──────────────────────────────────────────

  describe("Full workflow: PM → Design → Dev → QA → DevOps across 5 nodes", () => {
    it("each node creates items independently, PM sweep cascades through network", () => {
      // Each node creates its own items in its own database
      const prd = pm.engine.addItem(pm.node.id, "prd", "Check-In PRD", "", "JIRA-101");
      pm.engine.verifyItem(prd.id, "Approved", "alice");

      const screen = design.engine.addItem(design.node.id, "screen-spec", "QR Screen", "", "FIGMA-201");
      design.engine.verifyItem(screen.id, "Reviewed", "bob");

      const api = dev.engine.addItem(dev.node.id, "api-spec", "Check-In API", "", "");
      dev.engine.verifyItem(api.id, "Reviewed", "cuong");

      const tc = qa.engine.addItem(qa.node.id, "test-case", "QR Test", "", "");
      qa.engine.verifyItem(tc.id, "Passes", "diana");

      const rb = devops.engine.addItem(devops.node.id, "runbook", "Deploy Runbook", "", "");
      devops.engine.verifyItem(rb.id, "Reviewed", "eve");

      // Each node's items are in their own isolated store
      expect(pm.engine.listItems(pm.node.id)).toHaveLength(1);
      expect(design.engine.listItems(design.node.id)).toHaveLength(1);
      expect(dev.engine.listItems(dev.node.id)).toHaveLength(1);
      expect(qa.engine.listItems(qa.node.id)).toHaveLength(1);
      expect(devops.engine.listItems(devops.node.id)).toHaveLength(1);

      // PM broadcasts sweep for JIRA-101
      pm.broadcast({
        type: "sweep",
        externalRef: "JIRA-101",
        newValue: "requirements changed",
      });

      // All nodes receive the sweep
      expect(design.events.filter((e) => e.type === "sweep")).toHaveLength(1);
      expect(dev.events.filter((e) => e.type === "sweep")).toHaveLength(1);
      expect(qa.events.filter((e) => e.type === "sweep")).toHaveLength(1);
      expect(devops.events.filter((e) => e.type === "sweep")).toHaveLength(1);

      // PM's local sweep finds and propagates its own item
      const pmResult = pm.engine.sweep("JIRA-101");
      expect(pmResult.matchedItems).toHaveLength(1);
      expect(pmResult.matchedItems[0].id).toBe(prd.id);
    });
  });

  // ── Trace Resolution Across Nodes ─────────────────────────────────────

  describe("Cross-node trace resolution", () => {
    it("Dev requests trace resolve from PM, PM responds with item data", () => {
      const prd = pm.engine.addItem(pm.node.id, "prd", "Check-In PRD", "", "JIRA-101");
      pm.engine.verifyItem(prd.id, "Approved", "alice");

      // Dev asks PM to resolve a trace reference
      dev.send(pm.node.id, {
        type: "trace_resolve_request",
        itemId: prd.id,
      });

      // PM receives and processes — WSHandlers looks up the item locally
      const pmResolves = pm.events.filter((e) => e.type === "trace_resolve_request");
      expect(pmResolves).toHaveLength(1);

      // PM's WSHandlers emits trace_resolve_response locally
      const pmResponses = pm.events.filter((e) => e.type === "trace_resolve_response");
      expect(pmResponses).toHaveLength(1);
      const responseData = pmResponses[0].data as {
        type: string;
        itemId: string;
        title: string;
        kind: string;
        state: string;
      };
      expect(responseData.itemId).toBe(prd.id);
      expect(responseData.title).toBe("Check-In PRD");
      expect(responseData.kind).toBe("prd");
      expect(responseData.state).toBe("proven");

      // Dev also receives the trace_resolve_response via sendFn → router
      const devResponses = dev.events.filter((e) => e.type === "trace_resolve_response");
      expect(devResponses).toHaveLength(1);
      const devResponseData = devResponses[0].data as { itemId: string; title: string };
      expect(devResponseData.itemId).toBe(prd.id);
      expect(devResponseData.title).toBe("Check-In PRD");
    });

    it("trace resolve for nonexistent item does not crash", () => {
      dev.send(pm.node.id, {
        type: "trace_resolve_request",
        itemId: "nonexistent-item-id",
      });

      // PM receives request, but item doesn't exist — should not crash
      const pmEvents = pm.events.filter((e) => e.type === "trace_resolve_request");
      expect(pmEvents).toHaveLength(1);
      // No trace_resolve_response emitted (item not found)
    });
  });

  // ── Node Offline / Reconnect ──────────────────────────────────────────

  describe("Node goes offline and misses messages", () => {
    it("offline node does not receive broadcasts", () => {
      // QA goes offline
      router.unregister(qa.node.id);

      pm.broadcast({
        type: "signal_change",
        itemId: "item-001",
        oldState: "proven",
        newState: "suspect",
      });

      // QA missed the message
      expect(qa.events.filter((e) => e.type === "signal_change")).toHaveLength(0);

      // Others still received it
      expect(dev.events.filter((e) => e.type === "signal_change")).toHaveLength(1);
      expect(design.events.filter((e) => e.type === "signal_change")).toHaveLength(1);
      expect(devops.events.filter((e) => e.type === "signal_change")).toHaveLength(1);
    });

    it("direct message to offline node is dropped", () => {
      router.unregister(dev.node.id);

      pm.send(dev.node.id, {
        type: "query_ask",
        question: "Are you there?",
        askerId: pm.node.id,
      });

      // Dev never receives it
      expect(dev.events.filter((e) => e.type === "query_ask")).toHaveLength(0);
    });

    it("node reconnects and receives new messages", () => {
      // QA goes offline
      router.unregister(qa.node.id);

      pm.broadcast({
        type: "signal_change",
        itemId: "item-001",
        oldState: "proven",
        newState: "suspect",
      });

      expect(qa.events.filter((e) => e.type === "signal_change")).toHaveLength(0);

      // QA reconnects
      router.register({
        nodeId: qa.node.id,
        projectId: PROJECT,
        onMessage: (envelope) => qa.wsHandlers.handle(envelope),
      });

      // New broadcast after reconnect
      pm.broadcast({
        type: "signal_change",
        itemId: "item-002",
        oldState: "unverified",
        newState: "proven",
      });

      // QA receives the new one
      expect(qa.events.filter((e) => e.type === "signal_change")).toHaveLength(1);
    });
  });

  // ── Error Propagation ─────────────────────────────────────────────────

  describe("Error messages between nodes", () => {
    it("Dev sends error back to PM", () => {
      dev.send(pm.node.id, {
        type: "error",
        code: "ITEM_NOT_FOUND",
        message: "Cannot resolve trace: item does not exist on dev node",
      });

      const pmErrors = pm.events.filter((e) => e.type === "error");
      expect(pmErrors).toHaveLength(1);
      const errorData = pmErrors[0].data as { code: string; message: string };
      expect(errorData.code).toBe("ITEM_NOT_FOUND");
    });
  });

  // ── Multi-Node Audit Comparison ───────────────────────────────────────

  describe("Each node runs independent audits", () => {
    it("5 nodes have independent inventories and audit results", () => {
      // Each node adds different numbers of items
      pm.engine.addItem(pm.node.id, "prd", "PRD 1", "", "");
      pm.engine.addItem(pm.node.id, "user-story", "Story 1", "", "");
      pm.engine.addItem(pm.node.id, "user-story", "Story 2", "", "");

      design.engine.addItem(design.node.id, "screen-spec", "Screen 1", "", "");

      const devItem = dev.engine.addItem(dev.node.id, "api-spec", "API 1", "", "");
      dev.engine.addItem(dev.node.id, "tech-design", "Design 1", "", "");
      dev.engine.verifyItem(devItem.id, "Reviewed", "cuong");

      qa.engine.addItem(qa.node.id, "test-case", "TC 1", "", "");
      qa.engine.addItem(qa.node.id, "test-case", "TC 2", "", "");
      qa.engine.addItem(qa.node.id, "test-plan", "Plan 1", "", "");
      qa.engine.addItem(qa.node.id, "bug-report", "Bug 1", "", "");

      devops.engine.addItem(devops.node.id, "runbook", "Runbook 1", "", "");

      // Each node audits independently
      const pmAudit = pm.engine.audit(pm.node.id);
      const designAudit = design.engine.audit(design.node.id);
      const devAudit = dev.engine.audit(dev.node.id);
      const qaAudit = qa.engine.audit(qa.node.id);
      const devopsAudit = devops.engine.audit(devops.node.id);

      expect(pmAudit.totalItems).toBe(3);
      expect(designAudit.totalItems).toBe(1);
      expect(devAudit.totalItems).toBe(2);
      expect(qaAudit.totalItems).toBe(4);
      expect(devopsAudit.totalItems).toBe(1);

      // Dev has 1 proven, 1 unverified
      expect(devAudit.proven).toHaveLength(1);
      expect(devAudit.unverified).toHaveLength(1);

      // All PM items are orphans (no traces)
      expect(pmAudit.orphans).toHaveLength(3);

      // missingUpstreamRefs is always empty (vertical hierarchy removed)
      expect(pmAudit.missingUpstreamRefs).toHaveLength(0);
      expect(designAudit.missingUpstreamRefs).toHaveLength(0);
      expect(qaAudit.missingUpstreamRefs).toHaveLength(0);
    });
  });

  // ── Project Isolation ─────────────────────────────────────────────────

  describe("Project isolation", () => {
    it("messages from different projects are not received", () => {
      const otherRouter = new LocalRouter();
      const otherPm = createSimNode(otherRouter, "other-pm", "pm", "other-project", "frank");

      // Register other PM on the SAME router as our nodes
      router.register({
        nodeId: otherPm.node.id,
        projectId: "other-project",
        onMessage: (envelope) => otherPm.wsHandlers.handle(envelope),
      });

      // PM broadcasts in clinic-checkin project
      pm.broadcast({
        type: "signal_change",
        itemId: "item-001",
        oldState: "proven",
        newState: "suspect",
      });

      // Other project's PM should NOT receive it
      expect(otherPm.events.filter((e) => e.type === "signal_change")).toHaveLength(0);

      // Same project nodes still receive it
      expect(dev.events.filter((e) => e.type === "signal_change")).toHaveLength(1);

      otherPm.store.close();
    });
  });
});
