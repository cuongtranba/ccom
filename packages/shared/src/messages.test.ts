import { describe, expect, test } from "bun:test";
import { createEnvelope, parseEnvelope } from "./messages";
import type { MessagePayload } from "./messages";

describe("createEnvelope", () => {
  test("builds a valid envelope for query_ask", () => {
    const payload: MessagePayload = {
      type: "query_ask",
      question: "What is the status?",
      askerId: "node-a",
    };

    const envelope = createEnvelope("node-a", "node-b", "proj-1", payload);

    expect(envelope.messageId).toBeDefined();
    expect(typeof envelope.messageId).toBe("string");
    expect(envelope.messageId.length).toBeGreaterThan(0);
    expect(envelope.fromNode).toBe("node-a");
    expect(envelope.toNode).toBe("node-b");
    expect(envelope.projectId).toBe("proj-1");
    expect(envelope.timestamp).toBeDefined();
    expect(new Date(envelope.timestamp).toISOString()).toBe(envelope.timestamp);
    expect(envelope.payload).toEqual(payload);
  });
});

describe("parseEnvelope", () => {
  test("round-trips an ack envelope", () => {
    const payload: MessagePayload = {
      type: "ack",
      originalMessageId: "msg-42",
    };

    const original = createEnvelope("node-a", "node-b", "proj-1", payload);
    const parsed = parseEnvelope(JSON.stringify(original));

    expect(parsed).toEqual(original);
    expect(parsed.payload.type).toBe("ack");
    if (parsed.payload.type === "ack") {
      expect(parsed.payload.originalMessageId).toBe("msg-42");
    }
  });

  test("throws on invalid input", () => {
    expect(() => parseEnvelope("not json")).toThrow();
    expect(() => parseEnvelope(JSON.stringify({ payload: { type: "ack", originalMessageId: "m1" } }))).toThrow("Invalid envelope");
    expect(() => parseEnvelope(JSON.stringify({ messageId: "m1", payload: {} }))).toThrow("Invalid envelope");
  });
});
