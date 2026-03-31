import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { WSClient } from "../src/ws-client";

interface FakeWS {
  readyState: number;
  sent: string[];
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  send(data: string): void;
  close(): void;
  open(): void;
}

let capturedWS: FakeWS | null = null;

function installMockWebSocket() {
  (globalThis as Record<string, unknown>).WebSocket = class {
    static OPEN = 1;
    readyState = 0;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;

    constructor(_url: string) {
      capturedWS = this as unknown as FakeWS;
    }

    send(data: string) {
      (this as { sent: string[] }).sent.push(data);
    }

    close() {
      this.readyState = 3;
      this.onclose?.();
    }

    open() {
      this.readyState = 1;
      this.onopen?.();
    }
  };
}

describe("WSClient send queue", () => {
  let client: WSClient;

  beforeEach(() => {
    capturedWS = null;
    installMockWebSocket();
    client = new WSClient({
      serverUrl: "ws://test",
      token: "tok",
      nodeId: "node-b",
      projectIds: ["proj"],
    });
  });

  afterEach(() => {
    client.close();
  });

  test("queues message when not connected and sends on reconnect", async () => {
    const connectPromise = client.connect();
    const ws = capturedWS!;

    // Send while still CONNECTING (readyState=0)
    client.sendMessage("node-a", "proj", { type: "query_ask", question: "queued?", askerId: "node-b" });

    expect(client.queueDepth).toBe(1);
    expect(ws.sent).toHaveLength(0);

    // Open the connection — triggers drainSendQueue
    ws.open();
    await connectPromise;

    expect(client.queueDepth).toBe(0);
    expect(ws.sent).toHaveLength(1);
    const envelope = JSON.parse(ws.sent[0]);
    expect(envelope.payload.type).toBe("query_ask");
  });

  test("sends immediately when connected", async () => {
    const connectPromise = client.connect();
    capturedWS!.open();
    await connectPromise;

    client.sendMessage("node-a", "proj", { type: "query_ask", question: "direct", askerId: "node-b" });

    expect(client.queueDepth).toBe(0);
    expect(capturedWS!.sent).toHaveLength(1);
  });

  test("queues multiple messages during disconnect and drains all on reconnect", async () => {
    const connectPromise = client.connect();
    const ws = capturedWS!;
    ws.open();
    await connectPromise;

    // Simulate disconnect (set readyState to CLOSED without triggering onclose reconnect)
    ws.readyState = 3;

    client.sendMessage("node-a", "proj", { type: "query_ask", question: "msg1", askerId: "node-b" });
    client.sendMessage("node-a", "proj", { type: "query_ask", question: "msg2", askerId: "node-b" });
    client.sendMessage("node-a", "proj", { type: "query_ask", question: "msg3", askerId: "node-b" });

    expect(client.queueDepth).toBe(3);
    // No new messages sent yet
    expect(ws.sent).toHaveLength(0);

    // Simulate reconnect: open fires again on same ws
    ws.readyState = 1;
    ws.open();

    expect(client.queueDepth).toBe(0);
    expect(ws.sent).toHaveLength(3);

    const questions = ws.sent.map((s) => JSON.parse(s).payload.question);
    expect(questions).toEqual(["msg1", "msg2", "msg3"]);
  });

  test("drops messages when queue is full (maxQueueSize = 100)", () => {
    // Do not connect — stay in CONNECTING state
    for (let i = 0; i < 105; i++) {
      client.sendMessage("node-a", "proj", { type: "query_ask", question: `msg${i}`, askerId: "node-b" });
    }
    expect(client.queueDepth).toBe(100);
  });

  test("close clears the send queue", () => {
    client.connect().catch(() => {});
    client.sendMessage("node-a", "proj", { type: "query_ask", question: "will-be-cleared", askerId: "node-b" });
    expect(client.queueDepth).toBe(1);

    client.close();
    expect(client.queueDepth).toBe(0);
  });
});
