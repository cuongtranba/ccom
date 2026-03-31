export interface NodeConfig {
  node: {
    id: string;
    name: string;
    vertical: string;
    projects: string[];
    owner: string;
    isAI: boolean;
  };
  server: {
    url: string;
    token: string;
  };
}

export function defaultConfig(): NodeConfig {
  return {
    node: {
      id: "",
      name: "",
      vertical: "dev",
      projects: [],
      owner: "",
      isAI: false,
    },
    server: {
      url: "ws://localhost:8080/ws",
      token: "",
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
