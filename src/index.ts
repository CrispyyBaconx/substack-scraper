import { getDb } from "./db.ts";
import { createServer, broadcast } from "./server.ts";
import { startPolling } from "./scraper.ts";
import { ConfigSchema } from "./types.ts";

export const DATA_DIR = process.env.DATA_DIR || ".";

// --- Load config ---
const configFile = Bun.file(`${DATA_DIR}/config.json`);
if (!(await configFile.exists())) {
  console.error(`Missing ${DATA_DIR}/config.json — copy the example and edit it:`);
  console.error(`  cp config.json.example ${DATA_DIR}/config.json`);
  process.exit(1);
}

const rawConfig = await configFile.json();
const config = ConfigSchema.parse(rawConfig);

console.log("=== Substack Scraper ===");
console.log(`Newsletters: ${config.newsletters.length}`);
console.log(`Poll interval: ${config.pollIntervalMinutes} min`);
console.log(`Port: ${config.port}`);
console.log();

// --- Initialize DB ---
getDb();
console.log("[db] initialized");

// --- Start web server ---
createServer(config.port);

// --- Start polling loop ---
const poller = startPolling(config, broadcast);

// --- Graceful shutdown ---
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  poller.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\nShutting down...");
  poller.stop();
  process.exit(0);
});
