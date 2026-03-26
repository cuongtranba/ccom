import { describe, expect, test } from "bun:test";
import { createEnvelope, parseEnvelope } from "./messages";
import type { Envelope, MessagePayload } from "./messages";

describe("createEnvelope", () => {
  test("produces a valid envelope with all required fields", () => {
    const payload: MessagePayload = {
      type: "signal_change",
      itemId: "item-1",
      oldState: "unverified",
      newState: "proven",
    };

    const envelope = createEnvelope("node-a", "node-b", "proj-1", payload);

    expect(envelope.messageId).toBeDefined();
    expect(typeof envelope.messageId).toBe("string");
    expect(envelope.messageId.length).toBeGreaterThan(0);
    expect(envelope.fromNode).toBe("node-a");
    expect(envelope.toNode).toBe("node-b");
    expect(envelope.projectId).toBe("proj-1");
    expect(envelope.timestamp).toBeDefined();
    expect(envelope.payload).toEqual(payload);
  });

  test("generates unique messageIds for each call", () => {
    const payload: MessagePayload = {
      type: "ack",
      originalMessageId: "msg-1",
    };

    const e1 = createEnvelope("a", "b", "p", payload);
    const e2 = createEnvelope("a", "b", "p", payload);

    expect(e1.messageId).not.toBe(e2.messageId);
  });

  test("broadcast has empty toNode", () => {
    const payload: MessagePayload = {
      type: "sweep",
      externalRef: "https://example.com/doc",
      newValue: "updated content",
    };

    const envelope = createEnvelope("node-a", "", "proj-1", payload);

    expect(envelope.toNode).toBe("");
    expect(envelope.fromNode).toBe("node-a");
    expect(envelope.payload.type).toBe("sweep");
  });

  test("timestamp is a valid ISO string", () => {
    const payload: MessagePayload = {
      type: "error",
      code: "NOT_FOUND",
      message: "Item not found",
    };

    const envelope = createEnvelope("a", "b", "p", payload);
    const parsed = new Date(envelope.timestamp);

    expect(parsed.toISOString()).toBe(envelope.timestamp);
  });
});

describe("parseEnvelope", () => {
  test("round-trips with createEnvelope", () => {
    const payload: MessagePayload = {
      type: "query_ask",
      question: "What is item-2 status?",
      askerId: "alice",
    };

    const original = createEnvelope("node-a", "node-b", "proj-1", payload);
    const serialized = JSON.stringify(original);
    const parsed = parseEnvelope(serialized);

    expect(parsed).toEqual(original);
  });

  test("round-trips all payload types", () => {
    const payloads: MessagePayload[] = [
      { type: "signal_change", itemId: "i1", oldState: "unverified", newState: "proven" },
      { type: "sweep", externalRef: "ref-1", newValue: "val" },
      { type: "trace_resolve_request", itemId: "i2" },
      { type: "trace_resolve_response", itemId: "i3", title: "T", kind: "prd", state: "proven" },
      { type: "query_ask", question: "Q?", askerId: "a1" },
      { type: "query_respond", answer: "A", responderId: "r1" },
      { type: "ack", originalMessageId: "m1" },
      { type: "error", code: "ERR", message: "bad" },
    ];

    for (const payload of payloads) {
      const envelope = createEnvelope("from", "to", "proj", payload);
      const parsed = parseEnvelope(JSON.stringify(envelope));
      expect(parsed.payload).toEqual(payload);
    }
  });

  test("throws on invalid JSON", () => {
    expect(() => parseEnvelope("not json")).toThrow();
  });

  test("throws on missing messageId", () => {
    const invalid = JSON.stringify({ payload: { type: "ack", originalMessageId: "m1" } });
    expect(() => parseEnvelope(invalid)).toThrow("Invalid envelope");
  });

  test("throws on missing payload type", () => {
    const invalid = JSON.stringify({ messageId: "m1", payload: {} });
    expect(() => parseEnvelope(invalid)).toThrow("Invalid envelope");
  });

  test("throws on missing payload", () => {
    const invalid = JSON.stringify({ messageId: "m1" });
    expect(() => parseEnvelope(invalid)).toThrow("Invalid envelope");
  });
});
