import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { generateCcomConfig, generateMcpConfig, detectExistingFiles } from "../src/cli";

describe("CLI config generation", () => {
  test("generateCcomConfig creates valid config", () => {
    const config = generateCcomConfig({
      name: "dev-node",
      vertical: "dev",
      projects: ["clinic-checkin"],
      owner: "cuong",
      serverUrl: "ws://localhost:8080/ws",
      token: "test-token",
    });

    expect(config.node.name).toBe("dev-node");
    expect(config.node.vertical).toBe("dev");
    expect(config.node.projects).toEqual(["clinic-checkin"]);
    expect(config.node.owner).toBe("cuong");
    expect(config.server.url).toBe("ws://localhost:8080/ws");
    expect(config.server.token).toBe("test-token");
    expect((config as any).database).toBeUndefined();
  });

  test("generateCcomConfig handles multiple projects", () => {
    const config = generateCcomConfig({
      name: "multi-node",
      vertical: "frontend",
      projects: ["project-a", "project-b", "project-c"],
      owner: "tester",
      serverUrl: "ws://localhost:8080/ws",
      token: "tok",
    });
    expect(config.node.projects).toEqual(["project-a", "project-b", "project-c"]);
  });

  test("generateMcpConfig creates valid .mcp.json structure", () => {
    const config = generateMcpConfig("./ccom-config.json");
    expect(config).toEqual({
      mcpServers: {
        ccom: {
          command: "bunx",
          args: ["@tini-works/ccom@latest", "serve", "./ccom-config.json"],
        },
      },
    });
  });

  test("generateCcomConfig accepts any vertical string", () => {
    const config = generateCcomConfig({
      name: "custom-node",
      vertical: "frontend",
      projects: ["my-project"],
      owner: "tester",
      serverUrl: "ws://localhost:8080/ws",
      token: "tok",
    });
    expect(config.node.vertical).toBe("frontend");
  });
});

describe("detectExistingFiles", () => {
  const testDir = join(tmpdir(), `ccom-cli-test-${Date.now()}`);
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

  test("detects ccom-config.json", () => {
    writeFileSync("./ccom-config.json", "{}");
    expect(detectExistingFiles()).toContain("./ccom-config.json");
  });

  test("detects .mcp.json", () => {
    writeFileSync("./.mcp.json", "{}");
    expect(detectExistingFiles()).toContain("./.mcp.json");
  });

  test("detects all files when all exist", () => {
    writeFileSync("./ccom-config.json", "{}");
    writeFileSync("./.mcp.json", "{}");
    const found = detectExistingFiles();
    expect(found).toHaveLength(2);
    expect(found).toContain("./ccom-config.json");
    expect(found).toContain("./.mcp.json");
  });
});
