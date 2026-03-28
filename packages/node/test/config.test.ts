import { describe, expect, test } from "bun:test";
import { defaultConfig, loadConfig, type NodeConfig } from "../src/config";

describe("defaultConfig", () => {
  test("returns valid config with expected defaults", () => {
    const cfg = defaultConfig();

    expect(cfg.node.id).toBe("");
    expect(cfg.node.name).toBe("");
    expect(cfg.node.vertical).toBe("dev");
    expect(cfg.node.projects).toEqual([]);
    expect(cfg.node.owner).toBe("");
    expect(cfg.node.isAI).toBe(false);

    expect(cfg.server.url).toBe("ws://localhost:8080/ws");
    expect(cfg.server.token).toBe("");

    expect(cfg.database.path).toBe("./inventory.db");
  });

  test("returns default autonomy settings with auto and approval arrays", () => {
    const cfg = defaultConfig();

    expect(cfg.autonomy.auto).toEqual([
      "signal_change",
      "trace_resolve_request",
      "sweep",
      "query_respond",
    ]);
    expect(cfg.autonomy.approval).toEqual([
      "proposal_vote",
      "challenge_respond",
      "pair_invite",
      "cr_create",
    ]);
  });

  test("returns a fresh object each call (no shared mutable state)", () => {
    const a = defaultConfig();
    const b = defaultConfig();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a.node.id = "mutated";
    expect(b.node.id).toBe("");
  });
});

describe("loadConfig", () => {
  test("merges partial config with defaults, overriding only specified fields", () => {
    const cfg = loadConfig({
      node: { id: "n-1", name: "My Node" },
    });

    // overridden
    expect(cfg.node.id).toBe("n-1");
    expect(cfg.node.name).toBe("My Node");

    // retained defaults
    expect(cfg.node.vertical).toBe("dev");
    expect(cfg.node.projects).toEqual([]);
    expect(cfg.node.owner).toBe("");
    expect(cfg.node.isAI).toBe(false);

    // other sections untouched
    expect(cfg.server.url).toBe("ws://localhost:8080/ws");
    expect(cfg.database.path).toBe("./inventory.db");
  });

  test("handles nested partial overrides", () => {
    const cfg = loadConfig({
      server: { url: "wss://prod.example.com/ws" },
      database: { path: "/data/inventory.db" },
    });

    // overridden
    expect(cfg.server.url).toBe("wss://prod.example.com/ws");
    expect(cfg.database.path).toBe("/data/inventory.db");

    // nested defaults preserved
    expect(cfg.server.token).toBe("");
    expect(cfg.node.vertical).toBe("dev");
  });

  test("arrays in partial replace default arrays (not merge)", () => {
    const cfg = loadConfig({
      autonomy: {
        auto: ["sweep"],
        approval: [],
      },
    });

    expect(cfg.autonomy.auto).toEqual(["sweep"]);
    expect(cfg.autonomy.approval).toEqual([]);
  });

  test("empty partial returns defaults", () => {
    const cfg = loadConfig({});
    const def = defaultConfig();
    expect(cfg).toEqual(def);
  });

  test("does not mutate the default config", () => {
    const before = defaultConfig();
    loadConfig({ node: { id: "changed" } });
    const after = defaultConfig();
    expect(after).toEqual(before);
  });

  test("overrides node.isAI to true", () => {
    const cfg = loadConfig({
      node: { isAI: true },
    });
    expect(cfg.node.isAI).toBe(true);
    // other node defaults still present
    expect(cfg.node.vertical).toBe("dev");
  });
});
