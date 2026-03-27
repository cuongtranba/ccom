import { describe, test, expect } from "bun:test";
import { TOOL_DEFINITIONS } from "../src/channel";

describe("channel tool definitions", () => {
  test("defines 7 tools", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(7);
  });

  test("all tools have name, description, inputSchema", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
    }
  });

  test("tool names match expected set", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name).sort();
    expect(names).toEqual([
      "inv_add_item",
      "inv_add_trace",
      "inv_ask",
      "inv_audit",
      "inv_mark_broken",
      "inv_reply",
      "inv_verify",
    ]);
  });
});
