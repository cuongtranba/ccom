import { describe, expect, test } from "bun:test";
import type {
  Vertical,
  ItemState,
  ItemKind,
  TraceRelation,
  TransitionKind,
  Node,
  Item,
  Trace,
  Signal,
  Transition,
  Query,
  QueryResponse,
  AuditReport,
  PendingAction,
} from "./types";
import { UPSTREAM_VERTICALS } from "./types";

describe("domain types", () => {
  test("Vertical accepts all valid values", () => {
    const verticals: Vertical[] = ["pm", "design", "dev", "qa", "devops"];
    expect(verticals).toHaveLength(5);
  });

  test("ItemState accepts all valid values", () => {
    const states: ItemState[] = ["unverified", "proven", "suspect", "broke"];
    expect(states).toHaveLength(4);
  });

  test("ItemKind accepts all valid values", () => {
    const kinds: ItemKind[] = [
      "adr",
      "api-spec",
      "data-model",
      "tech-design",
      "epic",
      "user-story",
      "prd",
      "screen-spec",
      "user-flow",
      "test-case",
      "test-plan",
      "runbook",
      "bug-report",
      "decision",
      "custom",
    ];
    expect(kinds).toHaveLength(15);
  });

  test("TraceRelation accepts all valid values", () => {
    const relations: TraceRelation[] = ["traced_from", "matched_by", "proven_by"];
    expect(relations).toHaveLength(3);
  });

  test("TransitionKind accepts all valid values", () => {
    const transitions: TransitionKind[] = ["verify", "suspect", "re_verify", "break", "fix"];
    expect(transitions).toHaveLength(5);
  });

  test("Node interface compiles with valid values", () => {
    const node: Node = {
      id: "node-1",
      name: "PM Node",
      vertical: "pm",
      project: "proj-1",
      owner: "alice",
      isAI: false,
      createdAt: "2026-03-26T00:00:00.000Z",
    };
    expect(node.id).toBe("node-1");
    expect(node.vertical).toBe("pm");
    expect(node.isAI).toBe(false);
  });

  test("Item interface compiles with valid values", () => {
    const item: Item = {
      id: "item-1",
      nodeId: "node-1",
      kind: "prd",
      title: "Product Requirements",
      body: "The product shall...",
      externalRef: "https://example.com/prd",
      state: "unverified",
      evidence: "",
      confirmedBy: "",
      confirmedAt: null,
      version: 1,
      createdAt: "2026-03-26T00:00:00.000Z",
      updatedAt: "2026-03-26T00:00:00.000Z",
    };
    expect(item.id).toBe("item-1");
    expect(item.state).toBe("unverified");
    expect(item.confirmedAt).toBeNull();
    expect(item.version).toBe(1);
  });

  test("Trace interface compiles with valid values", () => {
    const trace: Trace = {
      id: "trace-1",
      fromItemId: "item-1",
      fromNodeId: "node-1",
      toItemId: "item-2",
      toNodeId: "node-2",
      relation: "traced_from",
      confirmedBy: "alice",
      confirmedAt: "2026-03-26T00:00:00.000Z",
      createdAt: "2026-03-26T00:00:00.000Z",
    };
    expect(trace.id).toBe("trace-1");
    expect(trace.relation).toBe("traced_from");
    expect(trace.confirmedAt).toBe("2026-03-26T00:00:00.000Z");
  });

  test("Signal interface compiles with valid values", () => {
    const signal: Signal = {
      id: "sig-1",
      kind: "change",
      sourceItem: "item-1",
      sourceNode: "node-1",
      targetItem: "item-2",
      targetNode: "node-2",
      payload: '{"delta":"updated body"}',
      processed: false,
      createdAt: "2026-03-26T00:00:00.000Z",
    };
    expect(signal.kind).toBe("change");
    expect(signal.processed).toBe(false);
  });

  test("Transition interface compiles with valid values", () => {
    const transition: Transition = {
      id: "tr-1",
      itemId: "item-1",
      kind: "verify",
      from: "unverified",
      to: "proven",
      evidence: "test passed",
      reason: "all tests green",
      actor: "alice",
      timestamp: "2026-03-26T00:00:00.000Z",
    };
    expect(transition.kind).toBe("verify");
    expect(transition.from).toBe("unverified");
    expect(transition.to).toBe("proven");
  });

  test("Query interface compiles with valid values", () => {
    const query: Query = {
      id: "q-1",
      askerId: "alice",
      askerNode: "node-1",
      question: "What is the status of item-2?",
      context: "Need for sprint planning",
      targetNode: "node-2",
      resolved: false,
      createdAt: "2026-03-26T00:00:00.000Z",
    };
    expect(query.resolved).toBe(false);
  });

  test("QueryResponse interface compiles with valid values", () => {
    const response: QueryResponse = {
      id: "qr-1",
      queryId: "q-1",
      responderId: "bob",
      nodeId: "node-2",
      answer: "Item is proven",
      isAI: true,
      createdAt: "2026-03-26T00:00:00.000Z",
    };
    expect(response.isAI).toBe(true);
  });

  test("AuditReport interface compiles with valid values", () => {
    const report: AuditReport = {
      nodeId: "node-1",
      totalItems: 5,
      unverified: ["item-1"],
      proven: ["item-2", "item-3"],
      suspect: [],
      broke: ["item-4"],
      orphans: ["item-5"],
      missingUpstreamRefs: ["item-1"],
    };
    expect(report.totalItems).toBe(5);
    expect(report.proven).toHaveLength(2);
  });

  test("PendingAction interface compiles with valid values", () => {
    const action: PendingAction = {
      id: "pa-1",
      messageType: "signal_change",
      envelope: '{"messageId":"..."}',
      summary: "State changed from unverified to proven",
      proposed: '{"action":"approve"}',
      status: "pending",
      createdAt: "2026-03-26T00:00:00.000Z",
    };
    expect(action.status).toBe("pending");
  });
});

describe("UPSTREAM_VERTICALS", () => {
  test("pm has no upstream", () => {
    expect(UPSTREAM_VERTICALS.pm).toEqual([]);
  });

  test("design depends on pm", () => {
    expect(UPSTREAM_VERTICALS.design).toEqual(["pm"]);
  });

  test("dev depends on pm and design", () => {
    expect(UPSTREAM_VERTICALS.dev).toEqual(["pm", "design"]);
  });

  test("qa depends on dev", () => {
    expect(UPSTREAM_VERTICALS.qa).toEqual(["dev"]);
  });

  test("devops depends on dev and qa", () => {
    expect(UPSTREAM_VERTICALS.devops).toEqual(["dev", "qa"]);
  });
});
