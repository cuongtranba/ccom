import { runWizard } from "./cli";
import { startChannelServer } from "./channel";

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === "init") {
    await runWizard();
    return;
  }

  // Default: start channel server
  // Arg can be config path, defaults to ./inv-config.json
  const configPath = command ?? "./inv-config.json";
  await startChannelServer(configPath);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
