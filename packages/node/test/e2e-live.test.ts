import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { WSClient } from "../src/ws-client";
import { createEnvelope, type Envelope } from "@inv/shared";

/**
 * Live E2E scenario: 4 nodes connect to the deployed inv-server and
 * exchange messages across all verticals.
 *
 * Run:
 *   E2E_LIVE=1 bun test packages/node/test/e2e-live.test.ts
 *
 * Requires the 4 tokens created on inv-server.apps.quickable.co.
 */

const SERVER_URL = process.env.E2E_LIVE_SERVER ?? "wss://inv-server.apps.quickable.co/ws";
const PROJECT = "clinic-checkin";

const TOKENS = {
  dev: process.env.E2E_DEV_TOKEN ?? "a2134106-e1e2-42da-84a4-5aef990e5842",
  pm: process.env.E2E_PM_TOKEN ?? "688272ef-5515-415b-9b2c-972543a0e3d4",
  qa: process.env.E2E_QA_TOKEN ?? "ccd25019-940a-422b-88a0-6207cbf4fc75",
  design: process.env.E2E_DESIGN_TOKEN ?? "1ae3192a-9d87-4c0f-aabe-bd4f45b53f6e",
};

const skip = !process.env.E2E_LIVE;

function collect(client: WSClient): Envelope[] {
  const msgs: Envelope[] = [];
  client.onMessage((e) => msgs.push(e));
  return msgs;
}

describe.skipIf(skip)("Live E2E: 4 nodes on inv-server.apps.quickable.co", () => {
  let dev: WSClient;
  let pm: WSClient;
  let qa: WSClient;
  let design: WSClient;

  let devMsgs: Envelope[];
  let pmMsgs: Envelope[];
  let qaMsgs: Envelope[];
  let designMsgs: Envelope[];

  beforeAll(async () => {
    dev = new WSClient({ serverUrl: SERVER_URL, token: TOKENS.dev, nodeId: "dev-node", projectId: PROJECT });
    pm = new WSClient({ serverUrl: SERVER_URL, token: TOKENS.pm, nodeId: "pm-node", projectId: PROJECT });
    qa = new WSClient({ serverUrl: SERVER_URL, token: TOKENS.qa, nodeId: "qa-node", projectId: PROJECT });
    design = new WSClient({ serverUrl: SERVER_URL, token: TOKENS.design, nodeId: "design-node", projectId: PROJECT });

    await Promise.all([dev.connect(), pm.connect(), qa.connect(), design.connect()]);

    devMsgs = collect(dev);
    pmMsgs = collect(pm);
    qaMsgs = collect(qa);
    designMsgs = collect(design);

    // Let connections stabilize
    await Bun.sleep(300);
  });

  afterAll(() => {
    dev?.close();
    pm?.close();
    qa?.close();
    design?.close();
  });

  // ── Scenario 1: Broadcast reaches all peers ────────────────────────

  it("PM broadcasts signal_change, all 3 other nodes receive it", async () => {
    pm.broadcast({
      type: "signal_change",
      itemId: "prd-001",
      oldState: "proven",
      newState: "suspect",
    });

    await Bun.sleep(800);

    expect(devMsgs.filter((e) => e.payload.type === "signal_change")).toHaveLength(1);
    expect(qaMsgs.filter((e) => e.payload.type === "signal_change")).toHaveLength(1);
    expect(designMsgs.filter((e) => e.payload.type === "signal_change")).toHaveLength(1);

    // PM does not echo
    expect(pmMsgs.filter((e) => e.payload.type === "signal_change")).toHaveLength(0);
  });

  // ── Scenario 2: Direct message delivery ────────────────────────────

  it("Dev sends direct query to QA only", async () => {
    // Clear previous
    devMsgs.length = 0;
    pmMsgs.length = 0;
    qaMsgs.length = 0;
    designMsgs.length = 0;

    dev.sendMessage("qa-node", {
      type: "query_ask",
      question: "Did the regression suite pass?",
      askerId: "dev-node",
    });

    await Bun.sleep(800);

    // Only QA gets it
    const qaQuestions = qaMsgs.filter((e) => e.payload.type === "query_ask");
    expect(qaQuestions).toHaveLength(1);
    expect(qaQuestions[0].fromNode).toBe("dev-node");

    // Others don't
    expect(pmMsgs.filter((e) => e.payload.type === "query_ask")).toHaveLength(0);
    expect(designMsgs.filter((e) => e.payload.type === "query_ask")).toHaveLength(0);
  });

  // ── Scenario 3: Multi-hop query/response ───────────────────────────

  it("QA broadcasts question, Dev and Design respond", async () => {
    devMsgs.length = 0;
    pmMsgs.length = 0;
    qaMsgs.length = 0;
    designMsgs.length = 0;

    qa.broadcast({
      type: "query_ask",
      question: "Anyone seeing flaky check-in on staging?",
      askerId: "qa-node",
    });

    await Bun.sleep(500);

    // All 3 peers receive
    expect(devMsgs.filter((e) => e.payload.type === "query_ask")).toHaveLength(1);
    expect(pmMsgs.filter((e) => e.payload.type === "query_ask")).toHaveLength(1);
    expect(designMsgs.filter((e) => e.payload.type === "query_ask")).toHaveLength(1);

    // Dev responds
    dev.sendMessage("qa-node", {
      type: "query_respond",
      answer: "Yes, race condition in queue handler",
      responderId: "dev-node",
    });

    // Design responds
    design.sendMessage("qa-node", {
      type: "query_respond",
      answer: "UI shows stale state after redirect",
      responderId: "design-node",
    });

    await Bun.sleep(500);

    const qaResponses = qaMsgs.filter((e) => e.payload.type === "query_respond");
    expect(qaResponses).toHaveLength(2);
  });

  // ── Scenario 4: Sweep broadcast ────────────────────────────────────

  it("PM sweeps external ref, all nodes notified", async () => {
    devMsgs.length = 0;
    pmMsgs.length = 0;
    qaMsgs.length = 0;
    designMsgs.length = 0;

    pm.broadcast({
      type: "sweep",
      externalRef: "JIRA-101",
      newValue: "requirements changed",
    });

    await Bun.sleep(800);

    expect(devMsgs.filter((e) => e.payload.type === "sweep")).toHaveLength(1);
    expect(qaMsgs.filter((e) => e.payload.type === "sweep")).toHaveLength(1);
    expect(designMsgs.filter((e) => e.payload.type === "sweep")).toHaveLength(1);
    expect(pmMsgs.filter((e) => e.payload.type === "sweep")).toHaveLength(0);
  });

  // ── Scenario 5: Invalid token rejected ─────────────────────────────

  it("invalid token cannot connect", async () => {
    // Use raw WebSocket with a timeout instead of WSClient (which auto-retries)
    const result = await Promise.race([
      new Promise<"rejected">((resolve) => {
        const ws = new WebSocket(`${SERVER_URL}?token=invalid-token-000`);
        ws.onclose = () => resolve("rejected");
        ws.onerror = () => resolve("rejected");
      }),
      Bun.sleep(3000).then(() => "timeout" as const),
    ]);

    expect(result).toBe("rejected");
  });

  // ── Scenario 6: Proposal broadcast ─────────────────────────────────

  it("Dev broadcasts proposal_create, all peers receive it", async () => {
    devMsgs.length = 0;
    pmMsgs.length = 0;
    qaMsgs.length = 0;
    designMsgs.length = 0;

    dev.broadcast({
      type: "proposal_create",
      crId: "cr-live-001",
      targetItemId: "api-spec-001",
      description: "Switch check-in endpoint to WebSocket",
      proposerNode: "dev-node",
    });

    await Bun.sleep(800);

    expect(pmMsgs.filter((e) => e.payload.type === "proposal_create")).toHaveLength(1);
    expect(qaMsgs.filter((e) => e.payload.type === "proposal_create")).toHaveLength(1);
    expect(designMsgs.filter((e) => e.payload.type === "proposal_create")).toHaveLength(1);
    expect(devMsgs.filter((e) => e.payload.type === "proposal_create")).toHaveLength(0);
  });

  // ── Scenario 7: Vote exchange ──────────────────────────────────────

  it("PM and QA vote on Dev's proposal via direct messages", async () => {
    devMsgs.length = 0;

    pm.sendMessage("dev-node", {
      type: "proposal_vote",
      crId: "cr-live-001",
      approve: true,
      reason: "Aligns with roadmap",
    });

    qa.sendMessage("dev-node", {
      type: "proposal_vote",
      crId: "cr-live-001",
      approve: false,
      reason: "Need more test coverage first",
    });

    await Bun.sleep(800);

    const votes = devMsgs.filter((e) => e.payload.type === "proposal_vote");
    expect(votes).toHaveLength(2);

    const approvals = votes.filter((e) => {
      const p = e.payload as { type: "proposal_vote"; approve: boolean };
      return p.approve === true;
    });
    const rejections = votes.filter((e) => {
      const p = e.payload as { type: "proposal_vote"; approve: boolean };
      return p.approve === false;
    });

    expect(approvals).toHaveLength(1);
    expect(rejections).toHaveLength(1);
  });

  // ── Scenario 8: Pair invite ────────────────────────────────────────

  it("Dev invites Design to pair, Design receives invite", async () => {
    designMsgs.length = 0;

    dev.sendMessage("design-node", {
      type: "pair_invite",
      sessionId: "ps-live-001",
      initiatorNode: "dev-node",
    });

    await Bun.sleep(500);

    const invites = designMsgs.filter((e) => e.payload.type === "pair_invite");
    expect(invites).toHaveLength(1);
    expect(invites[0].fromNode).toBe("dev-node");
  });
});
