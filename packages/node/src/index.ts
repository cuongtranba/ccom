import { runWizard } from "./cli";
import { startChannelServer } from "./channel";
import { version } from "../package.json";

async function main(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    case "version":
    case "--version":
    case "-v":
      console.log(`@tini-works/inv-node v${version}`);
      break;
    case "init":
      await runWizard();
      break;
    case "serve":
      await startChannelServer(process.argv[3] ?? "./inv-config.json");
      break;
    case undefined:
      // Backwards compat: no subcommand starts serve
      await startChannelServer(process.argv[3] ?? "./inv-config.json");
      break;
    case "update":
      console.log("Clearing bunx cache for @tini-works/inv-node...");
      const proc = Bun.spawn(["bun", "pm", "cache", "rm"], { stdout: "inherit", stderr: "inherit" });
      await proc.exited;
      console.log("Cache cleared. Next run will fetch the latest version.");
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Usage:");
      console.error("  inv-node version           Show current version");
      console.error("  inv-node init              Set up a new node");
      console.error("  inv-node serve [config]    Start MCP server");
      console.error("  inv-node update            Update to latest version");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
