import * as readline from "readline";
import type { Agent } from "./agent";
import type { WSClient } from "./ws-client";
import type { EventBus } from "./event-bus";
import type { NodeConfig } from "./config";

export class TUI {
  private rl: readline.Interface;

  constructor(
    private agent: Agent,
    private wsClient: WSClient | null,
    private eventBus: EventBus,
    private config: NodeConfig,
  ) {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async start(): Promise<void> {
    this.printHeader();
    this.setupEventListeners();
    this.promptLoop();
  }

  private printHeader(): void {
    const connected = this.wsClient?.connected ?? false;
    const status = connected ? "connected" : "offline";
    console.log("");
    console.log("┌─────────────────────────────────────────────┐");
    console.log("│           Inventory Node TUI                │");
    console.log("├─────────────────────────────────────────────┤");
    console.log(`│  Node:     ${this.pad(this.config.node.name, 32)} │`);
    console.log(`│  Vertical: ${this.pad(this.config.node.vertical, 32)} │`);
    console.log(`│  Project:  ${this.pad(this.config.node.project, 32)} │`);
    console.log(`│  Status:   ${this.pad(status, 32)} │`);
    console.log("├─────────────────────────────────────────────┤");
    console.log("│  Commands: /status /audit /pending /ask     │");
    console.log("│            /quit   or just chat naturally   │");
    console.log("└─────────────────────────────────────────────┘");
    console.log("");
  }

  private pad(text: string, width: number): string {
    if (text.length >= width) return text.slice(0, width);
    return text + " ".repeat(width - text.length);
  }

  private setupEventListeners(): void {
    this.eventBus.on("signal_change", (data) => {
      const payload = data as { itemId: string; oldState: string; newState: string };
      this.printEvent(`Signal: item ${payload.itemId.slice(0, 8)}... changed ${payload.oldState} -> ${payload.newState}`);
    });

    this.eventBus.on("sweep", (data) => {
      const payload = data as { externalRef: string };
      this.printEvent(`Sweep triggered for ref: ${payload.externalRef}`);
    });

    this.eventBus.on("query_ask", (data) => {
      const payload = data as { question: string; askerId: string };
      this.printEvent(`Query from ${payload.askerId.slice(0, 8)}...: ${payload.question}`);
    });

    this.eventBus.on("query_respond", (data) => {
      const payload = data as { answer: string; responderId: string };
      this.printEvent(`Answer from ${payload.responderId.slice(0, 8)}...: ${payload.answer}`);
    });

    this.eventBus.on("error", (data) => {
      const payload = data as { code: string; message: string };
      this.printEvent(`Error [${payload.code}]: ${payload.message}`);
    });
  }

  private printEvent(message: string): void {
    // Clear current line, print event, then re-display prompt
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(`  ┃ ${message}`);
    this.rl.prompt(true);
  }

  private promptLoop(): void {
    this.rl.setPrompt("you> ");
    this.rl.prompt();

    this.rl.on("line", (line: string) => {
      const input = line.trim();

      if (!input) {
        this.rl.prompt();
        return;
      }

      if (input.startsWith("/")) {
        this.handleSlashCommand(input)
          .catch((err) => {
            console.error("Command error:", err instanceof Error ? err.message : String(err));
          })
          .finally(() => {
            this.rl.prompt();
          });
      } else {
        this.handleChat(input)
          .catch((err) => {
            console.error("Chat error:", err instanceof Error ? err.message : String(err));
          })
          .finally(() => {
            this.rl.prompt();
          });
      }
    });

    this.rl.on("close", () => {
      this.shutdown();
    });
  }

  private async handleSlashCommand(input: string): Promise<void> {
    const parts = input.split(/\s+/);
    const command = parts[0];

    switch (command) {
      case "/status":
        console.log("\nFetching status...\n");
        const statusResponse = await this.agent.chat(
          "Show me the current inventory status",
        );
        console.log(statusResponse);
        console.log("");
        break;

      case "/audit":
        console.log("\nRunning audit...\n");
        const auditResponse = await this.agent.chat(
          "Run an audit of my inventory",
        );
        console.log(auditResponse);
        console.log("");
        break;

      case "/pending":
        console.log("\nChecking pending actions...\n");
        const pendingResponse = await this.agent.chat(
          "Show all pending actions that need my approval",
        );
        console.log(pendingResponse);
        console.log("");
        break;

      case "/ask": {
        if (parts.length < 2) {
          console.log("Usage: /ask [targetNode] <question>");
          break;
        }

        if (!this.wsClient?.connected) {
          console.log("Cannot send query: not connected to server");
          break;
        }

        // Determine if first arg is a target node or part of the question
        // If parts[1] looks like a UUID, treat it as targetNode
        const hasTarget =
          parts.length >= 3 &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            parts[1],
          );
        const targetNode = hasTarget ? parts[1] : "";
        const question = hasTarget
          ? parts.slice(2).join(" ")
          : parts.slice(1).join(" ");

        this.wsClient.broadcast({
          type: "query_ask",
          question,
          askerId: this.config.node.id,
        });
        console.log(
          targetNode
            ? `Query sent to node ${targetNode.slice(0, 8)}...`
            : "Query broadcast to network",
        );
        break;
      }

      case "/quit":
      case "/exit":
        this.shutdown();
        break;

      default:
        console.log(
          `Unknown command: ${command}. Available: /status /audit /pending /ask /quit`,
        );
    }
  }

  private async handleChat(input: string): Promise<void> {
    console.log("");
    const response = await this.agent.chat(input);
    console.log(response);
    console.log("");
  }

  private shutdown(): void {
    console.log("\nShutting down...");
    this.rl.close();
    this.wsClient?.close();
    process.exit(0);
  }
}
