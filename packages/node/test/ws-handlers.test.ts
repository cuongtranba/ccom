import { describe, it, expect, beforeEach } from "bun:test";
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
  let eventBus: EventBus;
  let handlers: WSHandlers;

  beforeEach(() => {
    eventBus = new EventBus();
    handlers = new WSHandlers(eventBus);
  });

  it("forwards query_ask to eventBus with fromNode attached", () => {
    let emittedData: unknown = null;
    eventBus.on("query_ask", (data) => {
      emittedData = data;
    });

    const envelope = makeEnvelope(
      {
        type: "query_ask",
        question: "What is this?",
        askerId: "user-1",
      },
      "node-sender",
      "node-b",
    );

    handlers.handle(envelope);

    expect(emittedData).toEqual({
      type: "query_ask",
      question: "What is this?",
      askerId: "user-1",
      fromNode: "node-sender",
    });
  });

  it("forwards query_respond to eventBus with fromNode attached", () => {
    let emittedData: unknown = null;
    eventBus.on("query_respond", (data) => {
      emittedData = data;
    });

    const envelope = makeEnvelope(
      {
        type: "query_respond",
        answer: "The answer is 42",
        responderId: "responder-1",
      },
      "node-responder",
      "node-b",
    );

    handlers.handle(envelope);

    expect(emittedData).toEqual({
      type: "query_respond",
      answer: "The answer is 42",
      responderId: "responder-1",
      fromNode: "node-responder",
    });
  });

  it("forwards ack to eventBus with fromNode attached", () => {
    let emittedData: unknown = null;
    eventBus.on("ack", (data) => {
      emittedData = data;
    });

    const envelope = makeEnvelope(
      {
        type: "ack",
        originalMessageId: "msg-orig",
      },
      "node-acker",
      "node-b",
    );

    handlers.handle(envelope);

    expect(emittedData).toEqual({
      type: "ack",
      originalMessageId: "msg-orig",
      fromNode: "node-acker",
    });
  });

  it("forwards error to eventBus with fromNode attached", () => {
    let emittedData: unknown = null;
    eventBus.on("error", (data) => {
      emittedData = data;
    });

    const envelope = makeEnvelope(
      {
        type: "error",
        code: "NOT_FOUND",
        message: "Item not found",
      },
      "node-errorer",
      "node-b",
    );

    handlers.handle(envelope);

    expect(emittedData).toEqual({
      type: "error",
      code: "NOT_FOUND",
      message: "Item not found",
      fromNode: "node-errorer",
    });
  });
});
