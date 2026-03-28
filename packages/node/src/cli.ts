import * as readline from "readline";
import { writeFileSync } from "fs";
import { slugify } from "@inv/shared";

// ── Config Generators (exported for testing) ────────────────────────

interface WizardInput {
  name: string;
  vertical: string;
  project: string;
  owner: string;
  serverUrl: string;
  token: string;
  dbPath: string;
}

interface InvConfig {
  node: { name: string; vertical: string; project: string; owner: string };
  server: { url: string; token: string };
  database: { path: string };
}

interface McpConfig {
  mcpServers: {
    inventory: {
      command: string;
      args: string[];
    };
  };
}

export function generateInvConfig(input: WizardInput): InvConfig {
  return {
    node: {
      name: input.name,
      vertical: input.vertical,
      project: input.project,
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

  const rawName = await ask(rl, "Node name");
  const name = slugify(rawName);
  if (name !== rawName) console.log(`  → normalized to: ${name}`);
  const vertical = await ask(rl, "Vertical", "dev");
  const rawProject = await ask(rl, "Project");
  const project = slugify(rawProject);
  if (project !== rawProject) console.log(`  → normalized to: ${project}`);
  const owner = await ask(rl, "Owner");

  console.log("");
  const serverUrl = await ask(rl, "Server URL", "ws://localhost:8080/ws");
  const token = await ask(rl, "Auth token");
  console.log("");
  const dbPath = await ask(rl, "Database path", "./inventory.db");

  rl.close();

  const invConfig = generateInvConfig({ name, vertical, project, owner, serverUrl, token, dbPath });
  const mcpConfig = generateMcpConfig("./inv-config.json");

  console.log("");

  const invConfigPath = "./inv-config.json";
  writeFileSync(invConfigPath, JSON.stringify(invConfig, null, 2) + "\n");
  console.log(`Writing ${invConfigPath}... ✓`);

  const mcpConfigPath = "./.mcp.json";
  writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + "\n");
  console.log(`Writing ${mcpConfigPath}... ✓`);

  console.log("");
  console.log("Setup complete! Start Claude Code:");
  console.log("  claude");
  console.log("");
}
