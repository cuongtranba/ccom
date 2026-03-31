import { describe, test, expect } from "bun:test";
import { TOOL_DEFINITIONS, buildToolHandlers } from "../src/channel";
import type { NodeConfig } from "../src/config";

const config: NodeConfig = {
  node: { id: "node-1", name: "test-node", vertical: "dev", projects: ["proj"], owner: "tester", isAI: false },
  server: { url: "ws://localhost:8080/ws", token: "tok" },
};

describe("channel tool definitions", () => {
  test("defines exactly 3 tools", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(3);
  });

  test("tool names are ccom_ prefixed", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toEqual(["ccom_ask", "ccom_reply", "ccom_online_nodes"]);
  });

  test("all tools have name, description, inputSchema", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
    }
  });
});

describe("buildToolHandlers", () => {
  test("ccom_ask without wsClient returns networkSent: false", async () => {
    const handleTool = buildToolHandlers(config, null);
    const result = await handleTool("ccom_ask", { question: "hello?" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.networkSent).toBe(false);
    expect(parsed.broadcast).toBe(true);
  });

  test("ccom_ask with targetNode sets broadcast: false", async () => {
    const handleTool = buildToolHandlers(config, null);
    const result = await handleTool("ccom_ask", { question: "hi", targetNode: "other-node" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.broadcast).toBe(false);
  });

  test("ccom_reply without wsClient returns error", async () => {
    const handleTool = buildToolHandlers(config, null);
    const result = await handleTool("ccom_reply", { answer: "yes", targetNode: "node-2" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });

  test("unknown tool returns error", async () => {
    const handleTool = buildToolHandlers(config, null);
    const result = await handleTool("unknown_tool", {});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("Unknown tool");
  });
});
