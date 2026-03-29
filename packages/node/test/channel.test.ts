import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { TOOL_DEFINITIONS, buildToolHandlers } from "../src/channel";
import { Store } from "../src/store";
import { StateMachine } from "../src/state";
import { SignalPropagator } from "../src/signal";
import { Engine } from "../src/engine";
import type { NodeConfig } from "../src/config";

describe("channel tool definitions", () => {
  test("defines 20 tools", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(20);
  });

  test("all tools have name, description, inputSchema", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
    }
  });

  test("tool names match expected set", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toEqual([
      "inv_add_item",
      "inv_add_trace",
      "inv_verify",
      "inv_mark_broken",
      "inv_audit",
      "inv_ask",
      "inv_reply",
      "inv_proposal_create",
      "inv_proposal_vote",
      "inv_challenge_create",
      "inv_challenge_respond",
      "inv_pair_invite",
      "inv_pair_join",
      "inv_pair_end",
      "inv_pair_list",
      "inv_checklist_add",
      "inv_checklist_check",
      "inv_checklist_uncheck",
      "inv_checklist_list",
      "inv_online_nodes",
    ]);
  });
});

describe("buildToolHandlers V2 tools", () => {
  let store: Store;
  let engine: Engine;
  let handleTool: ReturnType<typeof buildToolHandlers>;
  let nodeId: string;

  beforeEach(() => {
    store = new Store(":memory:");
    const sm = new StateMachine();
    const propagator = new SignalPropagator(store, sm);
    engine = new Engine(store, sm, propagator);

    const node = engine.registerNode("test-node", "dev", "proj", "tester", false);
    nodeId = node.id;

    const config: NodeConfig = {
      node: { id: nodeId, name: "test-node", vertical: "dev", projects: ["proj"], owner: "tester", isAI: false },
      server: { url: "", token: "" },
      database: { path: ":memory:" },
    };

    handleTool = buildToolHandlers(engine, config, null);
  });

  afterEach(() => {
    store.close();
  });

  test("inv_proposal_create creates a proposal in voting", async () => {
    const item = engine.addItem(nodeId, "prd", "Test PRD");
    const result = await handleTool("inv_proposal_create", { targetItemId: item.id, description: "Change scope" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.crId).toBeTruthy();
    expect(parsed.status).toBe("voting");
  });

  test("inv_checklist_add adds a checklist item", async () => {
    const item = engine.addItem(nodeId, "prd", "Test PRD");
    const result = await handleTool("inv_checklist_add", { itemId: item.id, text: "Review scope" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.text).toBe("Review scope");
    expect(parsed.checked).toBe(false);
  });

  test("inv_checklist_check and uncheck toggle state", async () => {
    const item = engine.addItem(nodeId, "prd", "Test PRD");
    const addResult = await handleTool("inv_checklist_add", { itemId: item.id, text: "Check me" });
    const clId = JSON.parse(addResult.content[0].text).id;

    await handleTool("inv_checklist_check", { checklistItemId: clId });
    const listResult = await handleTool("inv_checklist_list", { itemId: item.id });
    const items = JSON.parse(listResult.content[0].text);
    expect(items[0].checked).toBe(true);

    await handleTool("inv_checklist_uncheck", { checklistItemId: clId });
    const listResult2 = await handleTool("inv_checklist_list", { itemId: item.id });
    const items2 = JSON.parse(listResult2.content[0].text);
    expect(items2[0].checked).toBe(false);
  });

  test("inv_pair_invite creates a pending session", async () => {
    const partner = engine.registerNode("partner", "pm", "proj", "alice", false);
    const result = await handleTool("inv_pair_invite", { targetNode: partner.id });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.sessionId).toBeTruthy();
    expect(parsed.status).toBe("pending");
  });

  test("inv_pair_list lists sessions", async () => {
    const partner = engine.registerNode("partner", "pm", "proj", "alice", false);
    await handleTool("inv_pair_invite", { targetNode: partner.id });
    const result = await handleTool("inv_pair_list", {});
    const sessions = JSON.parse(result.content[0].text);
    expect(sessions).toHaveLength(1);
  });

  test("inv_online_nodes returns error when not configured", async () => {
    const result = await handleTool("inv_online_nodes", {});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Not configured for network");
  });

  test("inv_reply returns error when not connected to server", async () => {
    const result = await handleTool("inv_reply", { answer: "My answer", targetNode: "some-node" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Not connected to server");
  });

  test("inv_reply returns error for empty answer", async () => {
    const result = await handleTool("inv_reply", { answer: "", targetNode: "some-node" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });

  test("inv_reply returns error when answer param is missing", async () => {
    const result = await handleTool("inv_reply", { targetNode: "some-node" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });

  test("inv_reply ignores old 'message' param (regression guard)", async () => {
    const result = await handleTool("inv_reply", { message: "Should be ignored", targetNode: "some-node" });
    const parsed = JSON.parse(result.content[0].text);
    // Should error because 'answer' is empty/missing, not use 'message'
    expect(parsed.error).toBeTruthy();
  });

  test("inv_reply schema uses 'answer' not 'message'", () => {
    const replyTool = TOOL_DEFINITIONS.find((t) => t.name === "inv_reply")!;
    const props = replyTool.inputSchema.properties as Record<string, unknown>;
    expect(props.answer).toBeTruthy();
    expect(props.message).toBeUndefined();
    expect((replyTool.inputSchema.required as string[])).toContain("answer");
  });

  test("inv_reply handles very long answer", async () => {
    const longAnswer = "x".repeat(10000);
    const result = await handleTool("inv_reply", { answer: longAnswer, targetNode: "some-node" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Not connected to server");
  });

  test("inv_reply handles special characters in answer", async () => {
    const specialAnswer = 'Items:\n1. **prd** — "Test PRD"\n2. <api-spec> & more';
    const result = await handleTool("inv_reply", { answer: specialAnswer, targetNode: "some-node" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Not connected to server");
  });
});

describe("inv_reply with connected wsClient", () => {
  let store: Store;
  let engine: Engine;
  let handleTool: ReturnType<typeof buildToolHandlers>;
  let nodeId: string;
  let sentMessages: Array<{ toNode: string; projectId: string; payload: unknown }>;

  beforeEach(() => {
    store = new Store(":memory:");
    const sm = new StateMachine();
    const propagator = new SignalPropagator(store, sm);
    engine = new Engine(store, sm, propagator);

    const node = engine.registerNode("test-node", "dev", "proj", "tester", false);
    nodeId = node.id;

    sentMessages = [];
    const mockWsClient = {
      connected: true,
      sendMessage(toNode: string, projectId: string, payload: unknown) {
        sentMessages.push({ toNode, projectId, payload });
      },
    };

    const config: NodeConfig = {
      node: { id: nodeId, name: "test-node", vertical: "dev", projects: ["proj"], owner: "tester", isAI: false },
      server: { url: "", token: "" },
      database: { path: ":memory:" },
    };

    handleTool = buildToolHandlers(engine, config, mockWsClient as any);
  });

  afterEach(() => {
    store.close();
  });

  test("inv_reply sends answer via wsClient", async () => {
    const result = await handleTool("inv_reply", { answer: "Here are my items", targetNode: "pm-node" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.sent).toBe(true);
    expect(parsed.targetNode).toBe("pm-node");

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].toNode).toBe("pm-node");
    expect(sentMessages[0].projectId).toBe("proj");
    const payload = sentMessages[0].payload as { type: string; answer: string; responderId: string };
    expect(payload.type).toBe("query_respond");
    expect(payload.answer).toBe("Here are my items");
    expect(payload.responderId).toBe(nodeId);
  });

  test("inv_reply preserves markdown formatting in answer", async () => {
    const markdownAnswer = "## Items\n1. **prd** — Test\n2. **epic** — Auth\n\nTotal: 2 items";
    await handleTool("inv_reply", { answer: markdownAnswer, targetNode: "pm-node" });

    const payload = sentMessages[0].payload as { answer: string };
    expect(payload.answer).toBe(markdownAnswer);
  });

  test("inv_reply preserves unicode in answer", async () => {
    const unicodeAnswer = "Items: café ☕ résumé 日本語";
    await handleTool("inv_reply", { answer: unicodeAnswer, targetNode: "pm-node" });

    const payload = sentMessages[0].payload as { answer: string };
    expect(payload.answer).toBe(unicodeAnswer);
  });

  test("inv_reply rejects empty answer even when connected", async () => {
    const result = await handleTool("inv_reply", { answer: "", targetNode: "pm-node" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Answer cannot be empty");
    expect(sentMessages).toHaveLength(0);
  });
});

describe("auto-registration", () => {
  test("config file starts without node.id", () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`);
    writeFileSync(configPath, JSON.stringify({
      node: { name: "test-node", vertical: "dev", projects: ["test"], owner: "tester", isAI: false },
      server: { url: "", token: "" },
      database: { path: ":memory:" },
    }));

    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    expect(config.node.id).toBeFalsy();

    unlinkSync(configPath);
  });
});
