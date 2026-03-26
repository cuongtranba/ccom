import { readFileSync, existsSync } from "fs";
import { Store } from "./store";
import { StateMachine } from "./state";
import { SignalPropagator } from "./signal";
import { Engine } from "./engine";
import { EventBus } from "./event-bus";
import { WSHandlers } from "./ws-handlers";
import { WSClient } from "./ws-client";
import { Agent } from "./agent";
import { TUI } from "./tui";
import { loadConfig } from "./config";
import type { NodeConfig } from "./config";

async function main(): Promise<void> {
  // 1. Load config
  const configPath = process.argv[2] ?? "./inv-config.json";
  let config: NodeConfig;

  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, "utf-8");
    const partial = JSON.parse(raw) as Record<string, unknown>;
    config = loadConfig(partial);
  } else {
    console.warn(`Config file not found at ${configPath}, using defaults`);
    config = loadConfig({});
  }

  // 2. Create Store
  const store = new Store(config.database.path);

  // 3. Create StateMachine, SignalPropagator, Engine
  const sm = new StateMachine();
  const propagator = new SignalPropagator(store, sm);
  const engine = new Engine(store, sm, propagator);

  // 4. Register node if config.node.id is empty
  if (!config.node.id) {
    console.log("No node ID configured, registering new node...");
    const node = engine.registerNode(
      config.node.name || "unnamed-node",
      config.node.vertical,
      config.node.project || "default",
      config.node.owner || "local",
      config.node.isAI,
    );
    config.node.id = node.id;
    console.log(`Registered node: ${node.id} (${node.name})`);
  }

  // 5. Create EventBus, WSHandlers, WSClient
  const eventBus = new EventBus();
  const wsHandlers = new WSHandlers(engine, store, eventBus);

  let wsClient: WSClient | null = null;

  if (config.server.url && config.server.token) {
    wsClient = new WSClient({
      serverUrl: config.server.url,
      token: config.server.token,
      nodeId: config.node.id,
      projectId: config.node.project,
    });

    wsClient.onMessage((envelope) => {
      wsHandlers.handle(envelope);
    });

    // 6. Connect WSClient (try/catch, run offline if fails)
    try {
      await wsClient.connect();
      console.log("Connected to server");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Could not connect to server: ${message}`);
      console.warn("Running in offline mode");
      wsClient = null;
    }
  } else {
    console.log("No server URL or token configured, running in offline mode");
  }

  // 7. Create Agent, TUI
  const agent = new Agent(engine, store, config);
  const tui = new TUI(agent, wsClient, eventBus, config);

  // 8. Start TUI
  await tui.start();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
