import { describe, expect, test, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import Redis from "ioredis";
import { RedisAuth } from "../src/auth";
import { RedisOutbox } from "../src/outbox";
import { RedisHub } from "../src/hub";

const REDIS_DB = 15;

let redis: Redis;
let redisAvailable = false;

// Check Redis connectivity before running tests
beforeAll(async () => {
  try {
    redis = new Redis({ db: REDIS_DB, lazyConnect: true, connectTimeout: 2000 });
    await redis.connect();
    await redis.ping();
    redisAvailable = true;
  } catch {
    console.warn("Redis not available — skipping server tests");
    redisAvailable = false;
  }
});

afterAll(async () => {
  if (redisAvailable && redis) {
    await redis.quit();
  }
});

// ─── RedisAuth ───────────────────────────────────────────────────────

describe("RedisAuth", () => {
  let auth: RedisAuth;

  beforeEach(async () => {
    if (!redisAvailable) return;
    await redis.flushdb();
    auth = new RedisAuth(redis);
  });

  afterEach(async () => {
    if (!redisAvailable) return;
    await redis.flushdb();
  });

  test("createToken + validateToken round-trip", async () => {
    if (!redisAvailable) return;

    const token = await auth.createToken("proj-1", "node-a");
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    const info = await auth.validateToken(token);
    expect(info).not.toBeNull();
    expect(info!.projectId).toBe("proj-1");
    expect(info!.nodeId).toBe("node-a");
    expect(info!.createdAt).toBeDefined();
    // createdAt should be a valid ISO string
    expect(new Date(info!.createdAt).toISOString()).toBe(info!.createdAt);
  });

  test("validateToken returns null for invalid token", async () => {
    if (!redisAvailable) return;

    const info = await auth.validateToken("nonexistent-token");
    expect(info).toBeNull();
  });

  test("revokeToken removes token", async () => {
    if (!redisAvailable) return;

    const token = await auth.createToken("proj-1", "node-a");
    expect(await auth.validateToken(token)).not.toBeNull();

    await auth.revokeToken(token);
    expect(await auth.validateToken(token)).toBeNull();
  });

  test("revokeToken removes token from project index", async () => {
    if (!redisAvailable) return;

    const token = await auth.createToken("proj-1", "node-a");
    await auth.revokeToken(token);

    const tokens = await auth.listTokens("proj-1");
    expect(tokens).toHaveLength(0);
  });

  test("listTokens returns all tokens for a project", async () => {
    if (!redisAvailable) return;

    const t1 = await auth.createToken("proj-1", "node-a");
    const t2 = await auth.createToken("proj-1", "node-b");
    await auth.createToken("proj-2", "node-c");

    const tokens = await auth.listTokens("proj-1");
    expect(tokens).toHaveLength(2);

    const nodeIds = tokens.map((t) => t.nodeId).sort();
    expect(nodeIds).toEqual(["node-a", "node-b"]);
  });

  test("listTokens returns empty array for unknown project", async () => {
    if (!redisAvailable) return;

    const tokens = await auth.listTokens("nonexistent-project");
    expect(tokens).toHaveLength(0);
  });

  test("revokeByNode removes all tokens for a node", async () => {
    if (!redisAvailable) return;

    await auth.createToken("proj-1", "node-a");
    await auth.createToken("proj-1", "node-a"); // duplicate token for same node
    await auth.createToken("proj-1", "node-b");

    const revoked = await auth.revokeByNode("proj-1", "node-a");
    expect(revoked).toBe(2);

    const remaining = await auth.listTokens("proj-1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].nodeId).toBe("node-b");
  });

  test("revokeByProject removes all tokens and project entry", async () => {
    if (!redisAvailable) return;

    await auth.createToken("proj-1", "node-a");
    await auth.createToken("proj-1", "node-b");
    await auth.createToken("proj-2", "node-c");

    const revoked = await auth.revokeByProject("proj-1");
    expect(revoked).toBe(2);

    const proj1Tokens = await auth.listTokens("proj-1");
    expect(proj1Tokens).toHaveLength(0);

    // proj-2 should be unaffected
    const proj2Tokens = await auth.listTokens("proj-2");
    expect(proj2Tokens).toHaveLength(1);
  });

  test("nodeExists returns true for existing node", async () => {
    if (!redisAvailable) return;

    await auth.createToken("proj-1", "node-a");
    expect(await auth.nodeExists("proj-1", "node-a")).toBe(true);
    expect(await auth.nodeExists("proj-1", "node-b")).toBe(false);
  });
});

// ─── RedisOutbox ─────────────────────────────────────────────────────

describe("RedisOutbox", () => {
  let outbox: RedisOutbox;

  beforeEach(async () => {
    if (!redisAvailable) return;
    await redis.flushdb();
    outbox = new RedisOutbox(redis);
  });

  afterEach(async () => {
    if (!redisAvailable) return;
    await redis.flushdb();
  });

  test("enqueue + drain returns messages in order", async () => {
    if (!redisAvailable) return;

    await outbox.enqueue("proj-1", "node-a", "msg-1");
    await outbox.enqueue("proj-1", "node-a", "msg-2");
    await outbox.enqueue("proj-1", "node-a", "msg-3");

    const messages = await outbox.drain("proj-1", "node-a");
    expect(messages).toEqual(["msg-1", "msg-2", "msg-3"]);
  });

  test("drain on empty queue returns empty array", async () => {
    if (!redisAvailable) return;

    const messages = await outbox.drain("proj-1", "node-a");
    expect(messages).toEqual([]);
  });

  test("drain clears the queue", async () => {
    if (!redisAvailable) return;

    await outbox.enqueue("proj-1", "node-a", "msg-1");
    await outbox.enqueue("proj-1", "node-a", "msg-2");

    const first = await outbox.drain("proj-1", "node-a");
    expect(first).toHaveLength(2);

    const second = await outbox.drain("proj-1", "node-a");
    expect(second).toEqual([]);
  });

  test("depth reports correct queue length", async () => {
    if (!redisAvailable) return;

    expect(await outbox.depth("proj-1", "node-a")).toBe(0);

    await outbox.enqueue("proj-1", "node-a", "msg-1");
    await outbox.enqueue("proj-1", "node-a", "msg-2");

    expect(await outbox.depth("proj-1", "node-a")).toBe(2);
  });

  test("separate queues for different nodes", async () => {
    if (!redisAvailable) return;

    await outbox.enqueue("proj-1", "node-a", "msg-a");
    await outbox.enqueue("proj-1", "node-b", "msg-b");

    const msgsA = await outbox.drain("proj-1", "node-a");
    const msgsB = await outbox.drain("proj-1", "node-b");

    expect(msgsA).toEqual(["msg-a"]);
    expect(msgsB).toEqual(["msg-b"]);
  });
});

// ─── RedisHub ────────────────────────────────────────────────────────

describe("RedisHub", () => {
  let outbox: RedisOutbox;
  let hub: RedisHub;

  beforeEach(async () => {
    if (!redisAvailable) return;
    await redis.flushdb();
    outbox = new RedisOutbox(redis);
    hub = new RedisHub(redis, outbox, "instance-1");
  });

  afterEach(async () => {
    if (!redisAvailable) return;
    await hub.shutdown();
    await redis.flushdb();
  });

  test("register makes node online", async () => {
    if (!redisAvailable) return;

    const fakeWs = createFakeWebSocket();
    await hub.register("proj-1", "node-a", fakeWs);

    expect(await hub.isOnline("proj-1", "node-a")).toBe(true);
  });

  test("unregister makes node offline", async () => {
    if (!redisAvailable) return;

    const fakeWs = createFakeWebSocket();
    await hub.register("proj-1", "node-a", fakeWs);
    await hub.unregister("proj-1", "node-a");

    expect(await hub.isOnline("proj-1", "node-a")).toBe(false);
  });

  test("listOnline returns all registered nodes for project", async () => {
    if (!redisAvailable) return;

    const ws1 = createFakeWebSocket();
    const ws2 = createFakeWebSocket();
    await hub.register("proj-1", "node-a", ws1);
    await hub.register("proj-1", "node-b", ws2);

    const online = await hub.listOnline("proj-1");
    expect(online.sort()).toEqual(["node-a", "node-b"]);
  });

  test("listOnline excludes unregistered nodes", async () => {
    if (!redisAvailable) return;

    const ws1 = createFakeWebSocket();
    const ws2 = createFakeWebSocket();
    await hub.register("proj-1", "node-a", ws1);
    await hub.register("proj-1", "node-b", ws2);
    await hub.unregister("proj-1", "node-a");

    const online = await hub.listOnline("proj-1");
    expect(online).toEqual(["node-b"]);
  });

  test("isOnline returns false for unknown node", async () => {
    if (!redisAvailable) return;

    expect(await hub.isOnline("proj-1", "unknown")).toBe(false);
  });

  test("route delivers to local connection when toNode is set", async () => {
    if (!redisAvailable) return;

    const fakeWs = createFakeWebSocket();
    await hub.register("proj-1", "node-b", fakeWs);

    const envelope = {
      messageId: "msg-1",
      fromNode: "node-a",
      toNode: "node-b",
      projectId: "proj-1",
      timestamp: new Date().toISOString(),
      payload: { type: "ack" as const, originalMessageId: "orig-1" },
    };

    await hub.route(envelope);

    expect(fakeWs.sentMessages).toHaveLength(1);
    expect(fakeWs.sentMessages[0]).toBe(JSON.stringify(envelope));
  });

  test("route broadcasts to all except sender when toNode is empty", async () => {
    if (!redisAvailable) return;

    const wsA = createFakeWebSocket();
    const wsB = createFakeWebSocket();
    const wsC = createFakeWebSocket();
    await hub.register("proj-1", "node-a", wsA);
    await hub.register("proj-1", "node-b", wsB);
    await hub.register("proj-1", "node-c", wsC);

    const envelope = {
      messageId: "msg-1",
      fromNode: "node-a",
      toNode: "",
      projectId: "proj-1",
      timestamp: new Date().toISOString(),
      payload: { type: "sweep" as const, externalRef: "ref", newValue: "val" },
    };

    await hub.route(envelope);

    // Sender should NOT receive the message
    expect(wsA.sentMessages).toHaveLength(0);
    // Others should receive it
    expect(wsB.sentMessages).toHaveLength(1);
    expect(wsC.sentMessages).toHaveLength(1);
  });

  test("route to offline node enqueues in outbox", async () => {
    if (!redisAvailable) return;

    const envelope = {
      messageId: "msg-1",
      fromNode: "node-a",
      toNode: "node-b",
      projectId: "proj-1",
      timestamp: new Date().toISOString(),
      payload: { type: "ack" as const, originalMessageId: "orig-1" },
    };

    await hub.route(envelope);

    const queued = await outbox.drain("proj-1", "node-b");
    expect(queued).toHaveLength(1);
    expect(queued[0]).toBe(JSON.stringify(envelope));
  });

  test("drainOutbox sends queued messages to websocket", async () => {
    if (!redisAvailable) return;

    await outbox.enqueue("proj-1", "node-a", "queued-msg-1");
    await outbox.enqueue("proj-1", "node-a", "queued-msg-2");

    const fakeWs = createFakeWebSocket();
    await hub.drainOutbox("proj-1", "node-a", fakeWs);

    expect(fakeWs.sentMessages).toEqual(["queued-msg-1", "queued-msg-2"]);
  });

  // ── Reconnect drain ────────────────────────────────────────────────

  test("messages queued while offline are all delivered on reconnect", async () => {
    if (!redisAvailable) return;

    const envelope1 = {
      messageId: "msg-1",
      fromNode: "node-a",
      toNode: "node-b",
      projectId: "proj-1",
      timestamp: new Date().toISOString(),
      payload: { type: "ack" as const, originalMessageId: "x1" },
    };
    const envelope2 = {
      messageId: "msg-2",
      fromNode: "node-a",
      toNode: "node-b",
      projectId: "proj-1",
      timestamp: new Date().toISOString(),
      payload: { type: "ack" as const, originalMessageId: "x2" },
    };

    // node-b is offline — both messages go to outbox
    await hub.route(envelope1);
    await hub.route(envelope2);
    expect(await outbox.depth("proj-1", "node-b")).toBe(2);

    // node-b reconnects
    const fakeWs = createFakeWebSocket();
    await hub.register("proj-1", "node-b", fakeWs);
    await hub.drainOutbox("proj-1", "node-b", fakeWs);

    // All messages delivered in order, outbox empty
    expect(fakeWs.sentMessages).toHaveLength(2);
    expect(fakeWs.sentMessages[0]).toBe(JSON.stringify(envelope1));
    expect(fakeWs.sentMessages[1]).toBe(JSON.stringify(envelope2));
    expect(await outbox.depth("proj-1", "node-b")).toBe(0);
  });

  // ── Cross-instance pub/sub ─────────────────────────────────────────

  test("cross-instance routing delivers message via pub/sub", async () => {
    if (!redisAvailable) return;

    const redis2 = redis.duplicate();
    const hub2 = new RedisHub(redis2, outbox, "instance-2");

    try {
      const wsA = createFakeWebSocket();
      const wsB = createFakeWebSocket();

      await hub.register("proj-1", "node-a", wsA);   // node-a on instance-1
      await hub2.register("proj-1", "node-b", wsB);  // node-b on instance-2

      const envelope = {
        messageId: "msg-cross",
        fromNode: "node-a",
        toNode: "node-b",
        projectId: "proj-1",
        timestamp: new Date().toISOString(),
        payload: { type: "ack" as const, originalMessageId: "orig-cross" },
      };

      // instance-1 routes to node-b — sees it on instance-2 → publishes via pub/sub
      await hub.route(envelope);

      // Allow async pub/sub delivery to land on hub2
      await new Promise((r) => setTimeout(r, 100));

      expect(wsB.sentMessages).toHaveLength(1);
      expect(wsB.sentMessages[0]).toBe(JSON.stringify(envelope));
      // node-a should not receive its own message
      expect(wsA.sentMessages).toHaveLength(0);
    } finally {
      await hub2.shutdown();
      redis2.disconnect();
    }
  });

  // ── Metrics ────────────────────────────────────────────────────────

  test("getMetrics tracks routed, enqueued, and active connections", async () => {
    if (!redisAvailable) return;

    const wsA = createFakeWebSocket();
    await hub.register("proj-1", "node-a", wsA);

    const envelope = {
      messageId: "msg-1",
      fromNode: "node-a",
      toNode: "node-b", // node-b is offline
      projectId: "proj-1",
      timestamp: new Date().toISOString(),
      payload: { type: "ack" as const, originalMessageId: "x" },
    };
    await hub.route(envelope);

    const metrics = hub.getMetrics();
    expect(metrics.messages_routed).toBe(1);
    expect(metrics.messages_enqueued).toBe(1);
    expect(metrics.connections_active).toBe(1);
  });

  test("disconnect closes WS and unregisters node", async () => {
    if (!redisAvailable) return;

    const fakeWs = createFakeWebSocket();
    await hub.register("proj-1", "node-a", fakeWs);
    expect(await hub.isOnline("proj-1", "node-a")).toBe(true);

    const result = await hub.disconnect("proj-1", "node-a");
    expect(result).toBe(true);
    expect(fakeWs.closed).toBe(true);
    expect(await hub.isOnline("proj-1", "node-a")).toBe(false);
  });

  test("disconnect returns false for non-local node", async () => {
    if (!redisAvailable) return;

    const result = await hub.disconnect("proj-1", "unknown");
    expect(result).toBe(false);
  });

  test("disconnectProject closes all nodes in project", async () => {
    if (!redisAvailable) return;

    const ws1 = createFakeWebSocket();
    const ws2 = createFakeWebSocket();
    await hub.register("proj-1", "node-a", ws1);
    await hub.register("proj-1", "node-b", ws2);

    const count = await hub.disconnectProject("proj-1");
    expect(count).toBe(2);
    expect(ws1.closed).toBe(true);
    expect(ws2.closed).toBe(true);
    expect(await hub.isOnline("proj-1", "node-a")).toBe(false);
    expect(await hub.isOnline("proj-1", "node-b")).toBe(false);
  });

  test("getMetrics tracks drains_total and drain_messages_total", async () => {
    if (!redisAvailable) return;

    await outbox.enqueue("proj-1", "node-a", "m1");
    await outbox.enqueue("proj-1", "node-a", "m2");

    const fakeWs = createFakeWebSocket();
    await hub.drainOutbox("proj-1", "node-a", fakeWs);

    const metrics = hub.getMetrics();
    expect(metrics.drains_total).toBe(1);
    expect(metrics.drain_messages_total).toBe(2);
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────

interface FakeWebSocket {
  sentMessages: string[];
  closed: boolean;
  send(data: string): void;
  close(): void;
  readyState: number;
}

function createFakeWebSocket(): FakeWebSocket {
  return {
    sentMessages: [],
    closed: false,
    send(data: string) {
      this.sentMessages.push(data);
    },
    close() {
      this.closed = true;
      this.readyState = 3; // WebSocket.CLOSED
    },
    readyState: 1, // WebSocket.OPEN
  };
}
