#!/usr/bin/env node
/**
 * One shot end to end runner.
 *
 * Starts anvil, runs the suite against it, shuts it down. The suite deploys its
 * own fixture, so nothing outside this repository is needed beyond anvil itself.
 */

import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = process.env.PIPESHIFT_E2E_PORT ?? "8546";
const RPC_URL = `http://127.0.0.1:${PORT}`;

if (spawnSync("which", ["anvil"], { encoding: "utf8" }).status !== 0) {
  console.error("\nanvil is required. Install Foundry: https://getfoundry.sh\n");
  process.exit(1);
}

console.error(`starting anvil on port ${PORT}`);
const anvil = spawn("anvil", ["--port", PORT, "--silent"], { stdio: "inherit" });

const shutdown = () => {
  if (!anvil.killed) anvil.kill("SIGTERM");
};
process.on("exit", shutdown);
process.on("SIGINT", () => {
  shutdown();
  process.exit(130);
});

let up = false;
for (let i = 0; i < 60 && !up; i += 1) {
  try {
    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    up = response.ok;
  } catch {
    await sleep(250);
  }
}

if (!up) {
  shutdown();
  console.error("anvil did not come up");
  process.exit(1);
}

const suite = spawnSync(
  process.execPath,
  ["--test", "--experimental-strip-types", "e2e/fetch.e2e.ts"],
  {
    stdio: "inherit",
    env: { ...process.env, PIPESHIFT_RPC_URL: RPC_URL, PIPESHIFT_CHAIN_ID: "31337" },
  },
);

shutdown();
process.exit(suite.status ?? 1);
