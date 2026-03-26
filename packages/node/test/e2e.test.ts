import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { WSClient } from "../src/ws-client";
import { createEnvelope, type Envelope } from "@inv/shared";

/**
 * E2E test: two nodes connect to the running Docker server and exchange messages.
 *
 * Prerequisites:
 *   docker compose up -d
 *   docker compose exec server bun run packages/server/src/index.ts token create \
 *     --project clinic-checkin --node dev-inventory --redis redis://redis:6379
 *   docker compose exec server bun run packages/server/src/index.ts token create \
 *     --project clinic-checkin --node pm-inventory --redis redis://redis:6379
 *
 * Set E2E_DEV_TOKEN and E2E_PM_TOKEN env vars, or skip if not set.
 */

const SERVER_URL = process.env.E2E_SERVER_URL ?? "ws://localhost:4400/ws";
const DEV_TOKEN = process.env.E2E_DEV_TOKEN ?? "";
const PM_TOKEN = process.env.E2E_PM_TOKEN ?? "";
const PROJECT = "clinic-checkin";

const skip = !DEV_TOKEN || !PM_TOKEN;

describe.skipIf(skip)("E2E: two nodes via Docker server", () => {
  let devClient: WSClient;
  let pmClient: WSClient;

  beforeAll(async () => {
    devClient = new WSClient({
      serverUrl: SERVER_URL,
      token: DEV_TOKEN,
      nodeId: "dev-inventory",
      projectId: PROJECT,
    });

    pmClient = new WSClient({
      serverUrl: SERVER_URL,
      token: PM_TOKEN,
      nodeId: "pm-inventory",
      projectId: PROJECT,
    });

    await devClient.connect();
    await pmClient.connect();
  });

  afterAll(() => {
    devClient?.close();
    pmClient?.close();
  });

  it("dev broadcasts signal_change, pm receives it", async () => {
    const received: Envelope[] = [];

    pmClient.onMessage((envelope) => {
      received.push(envelope);
    });

    // Small delay to ensure subscription is ready
    await Bun.sleep(100);

    devClient.broadcast({
      type: "signal_change",
      itemId: "item-001",
      oldState: "proven",
      newState: "suspect",
    });

    // Wait for message to arrive
    await Bun.sleep(500);

    expect(received.length).toBeGreaterThanOrEqual(1);
    const msg = received[0];
    expect(msg.fromNode).toBe("dev-inventory");
    expect(msg.projectId).toBe(PROJECT);
    expect(msg.payload.type).toBe("signal_change");
    if (msg.payload.type === "signal_change") {
      expect(msg.payload.itemId).toBe("item-001");
      expect(msg.payload.newState).toBe("suspect");
    }
  });

  it("pm sends direct message to dev, dev receives it", async () => {
    const received: Envelope[] = [];

    devClient.onMessage((envelope) => {
      received.push(envelope);
    });

    await Bun.sleep(100);

    pmClient.sendMessage("dev-inventory", {
      type: "query_ask",
      question: "What is the API endpoint for check-in?",
      askerId: "pm-user",
    });

    await Bun.sleep(500);

    expect(received.length).toBeGreaterThanOrEqual(1);
    const msg = received[0];
    expect(msg.fromNode).toBe("pm-inventory");
    expect(msg.toNode).toBe("dev-inventory");
    expect(msg.payload.type).toBe("query_ask");
    if (msg.payload.type === "query_ask") {
      expect(msg.payload.question).toBe("What is the API endpoint for check-in?");
    }
  });

  it("broadcast does not echo back to sender", async () => {
    const selfReceived: Envelope[] = [];

    devClient.onMessage((envelope) => {
      selfReceived.push(envelope);
    });

    await Bun.sleep(100);

    devClient.broadcast({
      type: "sweep",
      externalRef: "PRD-001",
      newValue: "updated",
    });

    await Bun.sleep(500);

    // Dev should NOT receive its own broadcast
    const selfEchoes = selfReceived.filter(
      (e) => e.fromNode === "dev-inventory" && e.payload.type === "sweep",
    );
    expect(selfEchoes).toHaveLength(0);
  });

  it("invalid token is rejected", async () => {
    const badClient = new WSClient({
      serverUrl: SERVER_URL,
      token: "invalid-token-000",
      nodeId: "bad-node",
      projectId: PROJECT,
    });

    let connected = false;
    let errored = false;
    try {
      await badClient.connect();
      connected = true;
    } catch {
      errored = true;
    }

    badClient.close();

    // Should have failed to connect or been rejected
    expect(errored || !connected).toBe(true);
  });
});
