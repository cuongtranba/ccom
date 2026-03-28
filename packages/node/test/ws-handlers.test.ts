import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { Store } from "../src/store";
import { StateMachine } from "../src/state";
import { SignalPropagator } from "../src/signal";
import { Engine } from "../src/engine";
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
  let store: Store;
  let sm: StateMachine;
  let propagator: SignalPropagator;
  let engine: Engine;
  let eventBus: EventBus;
  let handlers: WSHandlers;

  beforeEach(() => {
    store = new Store(":memory:");
    sm = new StateMachine();
    propagator = new SignalPropagator(store, sm);
    engine = new Engine(store, sm, propagator);
    eventBus = new EventBus();
    handlers = new WSHandlers(engine, store, eventBus);
  });

  afterEach(() => {
    store.close();
  });

  it("handle signal_change calls engine.propagateChange and emits event", () => {
    const node = engine.registerNode("n", "dev", "p", "o", false);
    const item = engine.addItem(node.id, "decision", "T", "", "");

    let emitted = false;
    eventBus.on("signal_change", () => {
      emitted = true;
    });

    const envelope = makeEnvelope({
      type: "signal_change",
      itemId: item.id,
      oldState: "unverified",
      newState: "proven",
    });

    handlers.handle(envelope);

    expect(emitted).toBe(true);
  });

  it("handle signal_change does not throw for nonexistent item", () => {
    let emitted = false;
    eventBus.on("signal_change", () => {
      emitted = true;
    });

    const envelope = makeEnvelope({
      type: "signal_change",
      itemId: "nonexistent-id",
      oldState: "unverified",
      newState: "proven",
    });

    expect(() => handlers.handle(envelope)).not.toThrow();
    expect(emitted).toBe(true);
  });

  it("emits error event when trace_resolve_request fails", () => {
    const errors: unknown[] = [];
    eventBus.on("error", (data) => errors.push(data));

    const envelope = makeEnvelope({
      type: "trace_resolve_request",
      itemId: "nonexistent",
    });

    handlers.handle(envelope);

    const err = errors.find(
      (e) => (e as { code?: string }).code === "TRACE_RESOLVE_FAILED",
    );
    expect(err).toBeTruthy();
  });

  it("handle sweep calls engine.sweep and emits event", () => {
    let emittedData: unknown = null;
    eventBus.on("sweep", (data) => {
      emittedData = data;
    });

    const envelope = makeEnvelope({
      type: "sweep",
      externalRef: "EXT-1",
      newValue: "changed",
    });

    handlers.handle(envelope);

    expect(emittedData).toEqual({
      type: "sweep",
      externalRef: "EXT-1",
      newValue: "changed",
      fromNode: "node-a",
    });
  });

  it("handle trace_resolve_request emits response with item data", () => {
    const node = engine.registerNode("n", "dev", "p", "o", false);
    const item = engine.addItem(node.id, "decision", "My Title", "", "");

    let responseData: unknown = null;
    eventBus.on("trace_resolve_response", (data) => {
      responseData = data;
    });

    const envelope = makeEnvelope({
      type: "trace_resolve_request",
      itemId: item.id,
    });

    handlers.handle(envelope);

    expect(responseData).toEqual({
      type: "trace_resolve_response",
      itemId: item.id,
      title: "My Title",
      kind: "decision",
      state: "unverified",
    });
  });

  it("handle trace_resolve_request emits event even for missing item", () => {
    let traceRequestEmitted = false;
    eventBus.on("trace_resolve_request", () => {
      traceRequestEmitted = true;
    });

    const envelope = makeEnvelope({
      type: "trace_resolve_request",
      itemId: "nonexistent",
    });

    expect(() => handlers.handle(envelope)).not.toThrow();
    expect(traceRequestEmitted).toBe(true);
  });

  it("handle query_ask creates query in store and emits event", () => {
    const node = engine.registerNode("n", "dev", "proj-1", "o", false);

    let emitted = false;
    eventBus.on("query_ask", () => {
      emitted = true;
    });

    const envelope = makeEnvelope(
      {
        type: "query_ask",
        question: "What is this?",
        askerId: "user-1",
      },
      node.id,
      "target-node",
    );

    handlers.handle(envelope);

    expect(emitted).toBe(true);
  });

  it("handle query_ask auto-responds with local items via sendFn", () => {
    const node = engine.registerNode("n", "dev", "proj-1", "o", false);
    engine.addItem(node.id, "decision", "Item A", "", "");
    engine.addItem(node.id, "api-spec", "Item B", "", "REF-1");

    const sent: Array<{ toNode: string; payload: unknown }> = [];
    handlers.setSendFn((toNode, payload) => {
      sent.push({ toNode, payload });
    });

    const envelope = makeEnvelope(
      {
        type: "query_ask",
        question: "List all items",
        askerId: "pm-node-id",
      },
      "pm-node-id",
      node.id,
    );

    handlers.handle(envelope);

    expect(sent).toHaveLength(1);
    expect(sent[0].toNode).toBe("pm-node-id");
    const payload = sent[0].payload as { type: string; answer: string; responderId: string };
    expect(payload.type).toBe("query_respond");
    const answer = JSON.parse(payload.answer);
    expect(answer.count).toBe(2);
    expect(answer.items).toHaveLength(2);
  });

  it("handle trace_resolve_request sends response back via sendFn", () => {
    const node = engine.registerNode("n", "dev", "proj-1", "o", false);
    const item = engine.addItem(node.id, "decision", "My Item", "", "");

    const sent: Array<{ toNode: string; payload: unknown }> = [];
    handlers.setSendFn((toNode, payload) => {
      sent.push({ toNode, payload });
    });

    const envelope = makeEnvelope(
      { type: "trace_resolve_request", itemId: item.id },
      "requester-node",
      node.id,
    );

    handlers.handle(envelope);

    expect(sent).toHaveLength(1);
    expect(sent[0].toNode).toBe("requester-node");
    const payload = sent[0].payload as { type: string; itemId: string; title: string };
    expect(payload.type).toBe("trace_resolve_response");
    expect(payload.itemId).toBe(item.id);
    expect(payload.title).toBe("My Item");
  });

  it("handle query_respond emits event", () => {
    let emitted = false;
    eventBus.on("query_respond", () => {
      emitted = true;
    });

    const envelope = makeEnvelope({
      type: "query_respond",
      answer: "The answer is 42",
      responderId: "responder-1",
    });

    handlers.handle(envelope);

    expect(emitted).toBe(true);
  });

  it("handle ack emits event (no-op otherwise)", () => {
    let emitted = false;
    eventBus.on("ack", () => {
      emitted = true;
    });

    const envelope = makeEnvelope({
      type: "ack",
      originalMessageId: "msg-orig",
    });

    handlers.handle(envelope);

    expect(emitted).toBe(true);
  });

  it("handle error logs and emits event", () => {
    let emitted = false;
    eventBus.on("error", () => {
      emitted = true;
    });

    const envelope = makeEnvelope({
      type: "error",
      code: "NOT_FOUND",
      message: "Item not found",
    });

    handlers.handle(envelope);

    expect(emitted).toBe(true);
  });

  it("events are emitted for all message types", () => {
    const firedEvents: string[] = [];

    eventBus.on("signal_change", () => firedEvents.push("signal_change"));
    eventBus.on("sweep", () => firedEvents.push("sweep"));
    eventBus.on("trace_resolve_request", () => firedEvents.push("trace_resolve_request"));
    eventBus.on("trace_resolve_response", () => firedEvents.push("trace_resolve_response"));
    eventBus.on("query_ask", () => firedEvents.push("query_ask"));
    eventBus.on("query_respond", () => firedEvents.push("query_respond"));
    eventBus.on("ack", () => firedEvents.push("ack"));
    eventBus.on("error", () => firedEvents.push("error"));

    const node = engine.registerNode("n", "dev", "proj-1", "o", false);
    const item = engine.addItem(node.id, "decision", "T", "", "");

    handlers.handle(makeEnvelope({ type: "signal_change", itemId: item.id, oldState: "a", newState: "b" }));
    handlers.handle(makeEnvelope({ type: "sweep", externalRef: "r", newValue: "v" }));
    handlers.handle(makeEnvelope({ type: "trace_resolve_request", itemId: item.id }));
    handlers.handle(makeEnvelope({ type: "query_ask", question: "q", askerId: "a" }, node.id, "t"));
    handlers.handle(makeEnvelope({ type: "query_respond", answer: "a", responderId: "r" }));
    handlers.handle(makeEnvelope({ type: "ack", originalMessageId: "m" }));
    handlers.handle(makeEnvelope({ type: "error", code: "E", message: "msg" }));

    expect(firedEvents).toEqual([
      "signal_change",
      "sweep",
      "trace_resolve_response",
      "trace_resolve_request",
      "query_ask",
      "query_respond",
      "ack",
      "error",
    ]);
  });
});
