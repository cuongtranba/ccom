import { runWizard } from "./cli";
import { startChannelServer } from "./channel";

async function main(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
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
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Usage:");
      console.error("  inv-node init              Set up a new node");
      console.error("  inv-node serve [config]    Start MCP server");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
