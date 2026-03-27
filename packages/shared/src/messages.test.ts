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
      { type: "permission_request", requestId: "r1", tool: "inv_audit" } as MessagePayload,
      { type: "permission_verdict", requestId: "r1", allowed: true } as MessagePayload,
      { type: "proposal_create", crId: "cr-1", targetItemId: "i1", description: "change it", proposerNode: "n1" },
      { type: "proposal_vote", crId: "cr-1", approve: true, reason: "looks good" },
      { type: "proposal_result", crId: "cr-1", approved: true, tally: { approved: 3, rejected: 1, total: 4 } },
      { type: "challenge_create", challengeId: "ch-1", targetItemId: "i1", reason: "stale", challengerNode: "n2" },
      { type: "pair_invite", sessionId: "ps-1", initiatorNode: "n1" },
      { type: "pair_respond", sessionId: "ps-1", accepted: true },
      { type: "pair_end", sessionId: "ps-1" },
      { type: "checklist_update", itemId: "i1", checklistItemId: "cl-1", checked: true },
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

describe("permission_request envelope", () => {
  test("round-trips permission_request with inv_mark_broken args", () => {
    const envelope = createEnvelope("node-a", "node-b", "proj-1", {
      type: "permission_request",
      requestId: "req-1",
      tool: "inv_mark_broken",
      itemId: "item-1",
      reason: "broken in prod",
    });
    const parsed = parseEnvelope(JSON.stringify(envelope));
    expect(parsed.payload.type).toBe("permission_request");
    if (parsed.payload.type === "permission_request") {
      expect(parsed.payload.tool).toBe("inv_mark_broken");
      expect(parsed.payload.requestId).toBe("req-1");
    }
  });

  test("round-trips permission_request with inv_add_item args", () => {
    const envelope = createEnvelope("node-a", "node-b", "proj-1", {
      type: "permission_request",
      requestId: "req-2",
      tool: "inv_add_item",
      name: "New API Spec",
      kind: "api-spec",
      vertical: "dev",
    });
    const parsed = parseEnvelope(JSON.stringify(envelope));
    if (parsed.payload.type === "permission_request") {
      expect(parsed.payload.tool).toBe("inv_add_item");
      if (parsed.payload.tool === "inv_add_item") {
        expect(parsed.payload.name).toBe("New API Spec");
        expect(parsed.payload.kind).toBe("api-spec");
        expect(parsed.payload.vertical).toBe("dev");
      }
    }
  });
});

describe("permission_verdict envelope", () => {
  test("round-trips permission_verdict allowed", () => {
    const envelope = createEnvelope("node-b", "node-a", "proj-1", {
      type: "permission_verdict",
      requestId: "req-1",
      allowed: true,
    });
    const parsed = parseEnvelope(JSON.stringify(envelope));
    expect(parsed.payload.type).toBe("permission_verdict");
    if (parsed.payload.type === "permission_verdict") {
      expect(parsed.payload.allowed).toBe(true);
      expect(parsed.payload.requestId).toBe("req-1");
    }
  });

  test("round-trips permission_verdict denied with reason", () => {
    const envelope = createEnvelope("node-b", "node-a", "proj-1", {
      type: "permission_verdict",
      requestId: "req-1",
      allowed: false,
      reason: "Not authorized for this action",
    });
    const parsed = parseEnvelope(JSON.stringify(envelope));
    if (parsed.payload.type === "permission_verdict") {
      expect(parsed.payload.allowed).toBe(false);
      expect(parsed.payload.reason).toBe("Not authorized for this action");
    }
  });
});

describe("V2 message payloads", () => {
  test("round-trips proposal_create", () => {
    const payload: MessagePayload = {
      type: "proposal_create",
      crId: "cr-1",
      targetItemId: "item-1",
      description: "update the API spec",
      proposerNode: "node-a",
    };
    const envelope = createEnvelope("node-a", "node-b", "proj-1", payload);
    const parsed = parseEnvelope(JSON.stringify(envelope));
    expect(parsed.payload).toEqual(payload);
  });

  test("round-trips proposal_vote", () => {
    const payload: MessagePayload = {
      type: "proposal_vote",
      crId: "cr-1",
      approve: true,
      reason: "looks good to me",
    };
    const envelope = createEnvelope("node-b", "node-a", "proj-1", payload);
    const parsed = parseEnvelope(JSON.stringify(envelope));
    expect(parsed.payload).toEqual(payload);
  });

  test("round-trips proposal_result", () => {
    const payload: MessagePayload = {
      type: "proposal_result",
      crId: "cr-1",
      approved: true,
      tally: { approved: 3, rejected: 1, total: 4 },
    };
    const envelope = createEnvelope("node-a", "", "proj-1", payload);
    const parsed = parseEnvelope(JSON.stringify(envelope));
    expect(parsed.payload).toEqual(payload);
  });

  test("round-trips challenge_create", () => {
    const payload: MessagePayload = {
      type: "challenge_create",
      challengeId: "ch-1",
      targetItemId: "item-2",
      reason: "evidence is stale",
      challengerNode: "node-c",
    };
    const envelope = createEnvelope("node-c", "node-a", "proj-1", payload);
    const parsed = parseEnvelope(JSON.stringify(envelope));
    expect(parsed.payload).toEqual(payload);
  });

  test("round-trips pair_invite", () => {
    const payload: MessagePayload = {
      type: "pair_invite",
      sessionId: "ps-1",
      initiatorNode: "node-a",
    };
    const envelope = createEnvelope("node-a", "node-b", "proj-1", payload);
    const parsed = parseEnvelope(JSON.stringify(envelope));
    expect(parsed.payload).toEqual(payload);
  });

  test("round-trips pair_respond accepted", () => {
    const payload: MessagePayload = {
      type: "pair_respond",
      sessionId: "ps-1",
      accepted: true,
    };
    const envelope = createEnvelope("node-b", "node-a", "proj-1", payload);
    const parsed = parseEnvelope(JSON.stringify(envelope));
    expect(parsed.payload).toEqual(payload);
  });

  test("round-trips pair_respond rejected", () => {
    const payload: MessagePayload = {
      type: "pair_respond",
      sessionId: "ps-1",
      accepted: false,
    };
    const envelope = createEnvelope("node-b", "node-a", "proj-1", payload);
    const parsed = parseEnvelope(JSON.stringify(envelope));
    expect(parsed.payload).toEqual(payload);
  });

  test("round-trips pair_end", () => {
    const payload: MessagePayload = {
      type: "pair_end",
      sessionId: "ps-1",
    };
    const envelope = createEnvelope("node-a", "node-b", "proj-1", payload);
    const parsed = parseEnvelope(JSON.stringify(envelope));
    expect(parsed.payload).toEqual(payload);
  });

  test("round-trips checklist_update", () => {
    const payload: MessagePayload = {
      type: "checklist_update",
      itemId: "item-1",
      checklistItemId: "cl-1",
      checked: true,
    };
    const envelope = createEnvelope("node-a", "node-b", "proj-1", payload);
    const parsed = parseEnvelope(JSON.stringify(envelope));
    expect(parsed.payload).toEqual(payload);
  });

  test("round-trips checklist_update unchecked", () => {
    const payload: MessagePayload = {
      type: "checklist_update",
      itemId: "item-1",
      checklistItemId: "cl-2",
      checked: false,
    };
    const envelope = createEnvelope("node-a", "node-b", "proj-1", payload);
    const parsed = parseEnvelope(JSON.stringify(envelope));
    expect(parsed.payload).toEqual(payload);
  });
});
