import { describe, test, expect } from "bun:test";
import { generateInvConfig, generateMcpConfig } from "../src/cli";

describe("CLI config generation", () => {
  test("generateInvConfig creates valid config", () => {
    const config = generateInvConfig({
      name: "dev-node",
      vertical: "dev",
      projects: ["clinic-checkin"],
      owner: "cuong",
      serverUrl: "ws://localhost:8080/ws",
      token: "test-token",
      dbPath: "./inventory.db",
    });

    expect(config.node.name).toBe("dev-node");
    expect(config.node.vertical).toBe("dev");
    expect(config.node.projects).toEqual(["clinic-checkin"]);
    expect(config.node.owner).toBe("cuong");
    expect(config.server.url).toBe("ws://localhost:8080/ws");
    expect(config.server.token).toBe("test-token");
    expect(config.database.path).toBe("./inventory.db");
  });

  test("generateInvConfig handles multiple projects", () => {
    const config = generateInvConfig({
      name: "multi-node",
      vertical: "frontend",
      projects: ["project-a", "project-b", "project-c"],
      owner: "tester",
      serverUrl: "ws://localhost:8080/ws",
      token: "tok",
      dbPath: "./test.db",
    });
    expect(config.node.projects).toEqual(["project-a", "project-b", "project-c"]);
  });

  test("generateMcpConfig creates valid .mcp.json structure", () => {
    const config = generateMcpConfig("./inv-config.json");
    expect(config).toEqual({
      mcpServers: {
        inventory: {
          command: "bunx",
          args: ["@tini-works/inv-node@latest", "serve", "./inv-config.json"],
        },
      },
    });
  });

  test("generateInvConfig accepts any vertical string", () => {
    const config = generateInvConfig({
      name: "custom-node",
      vertical: "frontend",
      projects: ["my-project"],
      owner: "tester",
      serverUrl: "ws://localhost:8080/ws",
      token: "tok",
      dbPath: "./test.db",
    });
    expect(config.node.vertical).toBe("frontend");
  });
});
