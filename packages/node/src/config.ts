import type { Vertical } from "@inv/shared";

export interface NodeConfig {
  node: {
    id: string;
    name: string;
    vertical: Vertical;
    project: string;
    owner: string;
    isAI: boolean;
  };
  server: {
    url: string;
    token: string;
  };
  database: {
    path: string;
  };
  autonomy: {
    auto: string[];
    approval: string[];
  };
}

export function defaultConfig(): NodeConfig {
  return {
    node: {
      id: "",
      name: "",
      vertical: "dev",
      project: "",
      owner: "",
      isAI: false,
    },
    server: {
      url: "ws://localhost:8080/ws",
      token: "",
    },
    database: {
      path: "./inventory.db",
    },
    autonomy: {
      auto: ["signal_change", "trace_resolve_request", "sweep", "query_respond"],
      approval: ["proposal_vote", "challenge_respond", "pair_invite", "cr_create"],
    },
  };
}

export function loadConfig(partial: Record<string, unknown>): NodeConfig {
  const cfg = defaultConfig();
  return deepMerge(cfg, partial) as NodeConfig;
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      );
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}
