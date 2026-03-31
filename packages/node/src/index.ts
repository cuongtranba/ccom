import { runWizard } from "./cli";
import { startChannelServer } from "./channel";
import { version } from "../package.json";

async function main(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    case "version":
    case "--version":
    case "-v":
      console.log(`@tini-works/ccom v${version}`);
      break;
    case "init":
      await runWizard();
      break;
    case "serve":
      await startChannelServer(process.argv[3] ?? "./ccom-config.json");
      break;
    case undefined:
      // Backwards compat: no subcommand starts serve
      await startChannelServer(process.argv[3] ?? "./ccom-config.json");
      break;
    case "update":
      console.log("Clearing bunx cache for @tini-works/ccom...");
      const proc = Bun.spawn(["bun", "pm", "cache", "rm"], { stdout: "inherit", stderr: "inherit" });
      await proc.exited;
      console.log("Cache cleared. Next run will fetch the latest version.");
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Usage:");
      console.error("  ccom version           Show current version");
      console.error("  ccom init              Set up a new node");
      console.error("  ccom serve [config]    Start MCP server");
      console.error("  ccom update            Update to latest version");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
