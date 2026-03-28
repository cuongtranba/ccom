import { describe, test, expect } from "bun:test";
import { generateInvConfig, generateMcpConfig } from "../src/cli";
import type { Vertical } from "@inv/shared";

describe("CLI config generation", () => {
  test("generateInvConfig creates valid config", () => {
    const config = generateInvConfig({
      name: "dev-node",
      vertical: "dev" as Vertical,
      project: "clinic-checkin",
      owner: "cuong",
      serverUrl: "ws://localhost:8080/ws",
      token: "test-token",
      dbPath: "./inventory.db",
    });

    expect(config.node.name).toBe("dev-node");
    expect(config.node.vertical).toBe("dev");
    expect(config.node.project).toBe("clinic-checkin");
    expect(config.node.owner).toBe("cuong");
    expect(config.server.url).toBe("ws://localhost:8080/ws");
    expect(config.server.token).toBe("test-token");
    expect(config.database.path).toBe("./inventory.db");
  });

  test("generateMcpConfig creates valid .mcp.json structure", () => {
    const config = generateMcpConfig("./inv-config.json");
    expect(config).toEqual({
      mcpServers: {
        inventory: {
          command: "bunx",
          args: ["@inv/node", "serve", "./inv-config.json"],
        },
      },
    });
  });

  test("generateInvConfig handles all verticals", () => {
    const verticals: Vertical[] = ["pm", "design", "dev", "qa", "devops"];
    for (const v of verticals) {
      const config = generateInvConfig({
        name: `${v}-node`,
        vertical: v,
        project: "test",
        owner: "tester",
        serverUrl: "ws://localhost:8080/ws",
        token: "tok",
        dbPath: "./test.db",
      });
      expect(config.node.vertical).toBe(v);
    }
  });
});
