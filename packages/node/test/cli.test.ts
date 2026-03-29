import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { generateInvConfig, generateMcpConfig, generateStatusLine, detectExistingFiles } from "../src/cli";

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

  test("generateStatusLine creates initial status text", () => {
    const line = generateStatusLine("dev-node", "dev", "clinic-checkin");
    expect(line).toBe("inv: dev-node (dev) · clinic-checkin · 0 online");
  });

  test("generateStatusLine handles missing project", () => {
    const line = generateStatusLine("dev-node", "dev", "");
    expect(line).toBe("inv: dev-node (dev) · no project · 0 online");
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

describe("detectExistingFiles", () => {
  const testDir = join(tmpdir(), `inv-cli-test-${Date.now()}`);
  let origCwd: string;

  beforeEach(() => {
    const { mkdirSync } = require("fs");
    mkdirSync(testDir, { recursive: true });
    origCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    const { rmSync } = require("fs");
    rmSync(testDir, { recursive: true, force: true });
  });

  test("returns empty array when no files exist", () => {
    expect(detectExistingFiles()).toEqual([]);
  });

  test("detects inv-config.json", () => {
    writeFileSync("./inv-config.json", "{}");
    expect(detectExistingFiles()).toContain("./inv-config.json");
  });

  test("detects .mcp.json", () => {
    writeFileSync("./.mcp.json", "{}");
    expect(detectExistingFiles()).toContain("./.mcp.json");
  });

  test("detects database file with default path", () => {
    writeFileSync("./inventory.db", "");
    expect(detectExistingFiles()).toContain("./inventory.db");
  });

  test("detects database file with custom path", () => {
    writeFileSync("./custom.db", "");
    expect(detectExistingFiles("./custom.db")).toContain("./custom.db");
  });

  test("detects all files when all exist", () => {
    writeFileSync("./inv-config.json", "{}");
    writeFileSync("./.mcp.json", "{}");
    writeFileSync("./inventory.db", "");
    const found = detectExistingFiles();
    expect(found).toHaveLength(3);
    expect(found).toContain("./inv-config.json");
    expect(found).toContain("./.mcp.json");
    expect(found).toContain("./inventory.db");
  });
});
