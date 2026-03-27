import { describe, test, expect } from "bun:test";
import { TOOL_DEFINITIONS } from "../src/channel";

describe("channel tool definitions", () => {
  test("defines 19 tools", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(19);
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
    ]);
  });
});
