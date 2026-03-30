import * as readline from "readline";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { slugify } from "@inv/shared";

// ── Config Generators (exported for testing) ────────────────────────

interface WizardInput {
  name: string;
  vertical: string;
  projects: string[];
  owner: string;
  serverUrl: string;
  token: string;
  dbPath: string;
}

interface InvConfig {
  node: { name: string; vertical: string; projects: string[]; owner: string };
  server: { url: string; token: string };
  database: { path: string };
}

interface McpServerEntry {
  command: string;
  args: string[];
}

interface McpConfig {
  mcpServers: Record<string, McpServerEntry>;
}

export function generateInvConfig(input: WizardInput): InvConfig {
  return {
    node: {
      name: input.name,
      vertical: input.vertical,
      projects: input.projects,
      owner: input.owner,
    },
    server: {
      url: input.serverUrl,
      token: input.token,
    },
    database: {
      path: input.dbPath,
    },
  };
}

export function generateMcpConfig(configPath: string): McpConfig {
  return {
    mcpServers: {
      inventory: {
        command: "bunx",
        args: ["@tini-works/inv-node@latest", "serve", configPath],
      },
    },
  };
}

// ── Fetch token info from server ────────────────────────────────────

interface TokenInfoResponse {
  nodeId: string;
  name: string;
  vertical: string;
  owner: string;
  projects: { name: string }[];
}

export async function fetchTokenInfo(
  serverUrl: string,
  token: string,
): Promise<TokenInfoResponse> {
  const httpUrl = serverUrl
    .replace(/^ws/, "http")
    .replace(/\/ws$/, "/api/token/info");
  const res = await fetch(`${httpUrl}?token=${token}`);
  if (!res.ok) {
    const err = await res.json() as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<TokenInfoResponse>;
}

// ── Existing Files Detection ────────────────────────────────────────

export function detectExistingFiles(dbPath = "./inventory.db"): string[] {
  const candidates = ["./inv-config.json", "./.mcp.json", dbPath];
  return candidates.filter((f) => existsSync(f));
}

// ── Interactive Wizard ───────────────────────────────────────────────

function ask(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  const prompt = defaultValue ? `${question} (${defaultValue}): ` : `${question}: `;
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

export async function runWizard(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("");
  console.log("Inventory Node Setup");
  console.log("────────────────────");
  console.log("");

  // Check for existing files
  const existing = detectExistingFiles();
  if (existing.length > 0) {
    console.log("Found existing files:");
    for (const f of existing) {
      console.log(`  ${f}`);
    }
    console.log("");
    const choice = await ask(rl, "Reuse existing config or overwrite all? (reuse/overwrite)", "reuse");
    if (choice === "reuse") {
      console.log("");
      console.log("Reusing existing configuration. No changes made.");
      console.log("");
      console.log("Start Claude Code:");
      console.log("  claude --dangerously-load-development-channels server:inventory");
      console.log("");
      rl.close();
      return;
    }
    console.log("");
  }

  const serverUrl = await ask(rl, "Server URL", "ws://localhost:8080/ws");
  const token = await ask(rl, "Auth token");
  const dbPath = await ask(rl, "Database path", "./inventory.db");

  console.log("");
  console.log("Fetching node info from server...");

  let info: TokenInfoResponse;
  try {
    info = await fetchTokenInfo(serverUrl, token);
  } catch (err) {
    console.error(`Failed to fetch token info: ${err instanceof Error ? err.message : String(err)}`);
    rl.close();
    process.exit(1);
  }

  console.log(`  Node: ${info.name} (${info.nodeId})`);
  console.log(`  Vertical: ${info.vertical}`);
  console.log(`  Owner: ${info.owner}`);
  console.log(`  Projects: ${info.projects.map((p) => p.name).join(", ") || "(none)"}`);
  console.log("");

  rl.close();

  const invConfig = generateInvConfig({
    name: info.name,
    vertical: info.vertical,
    projects: info.projects.map((p) => p.name),
    owner: info.owner,
    serverUrl,
    token,
    dbPath,
  });
  const mcpConfig = generateMcpConfig("./inv-config.json");

  const invConfigPath = "./inv-config.json";
  writeFileSync(invConfigPath, JSON.stringify(invConfig, null, 2) + "\n");
  console.log(`Writing ${invConfigPath}... ✓`);

  const mcpConfigPath = "./.mcp.json";
  let finalMcpConfig = mcpConfig;
  if (existsSync(mcpConfigPath)) {
    try {
      const existing = JSON.parse(readFileSync(mcpConfigPath, "utf-8")) as McpConfig;
      finalMcpConfig = {
        ...existing,
        mcpServers: { ...existing.mcpServers, ...mcpConfig.mcpServers },
      };
    } catch {
      console.warn(`Warning: could not parse existing ${mcpConfigPath}, overwriting.`);
    }
  }
  writeFileSync(mcpConfigPath, JSON.stringify(finalMcpConfig, null, 2) + "\n");
  console.log(`Writing ${mcpConfigPath}... ✓`);

  console.log("");
  console.log("Setup complete! Start Claude Code:");
  console.log("  claude --dangerously-load-development-channels server:inventory");
  console.log("");
}
