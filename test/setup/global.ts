/**
 * Global test setup: boot a fresh anvil, deploy the protocol from the sibling ../unimod repo
 * (script/local-deploy.sh — the same deterministic deploy the devnet uses), and record the
 * RPC URL + deployments bundle for the test files in test/setup/.runtime.json.
 *
 * Requirements: foundry (anvil/forge) on PATH or in ~/.foundry/bin, and ../unimod checked out.
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Unique port per run: a straggler anvil from a previous (crashed) run must never be able to
// serve this run's requests — that leaks old chain state and fails tests in confusing ways.
const PORT = 8500 + (process.pid % 400);
const RPC = `http://127.0.0.1:${PORT}`;
const UNIMOD = resolve(__dirname, "../../../unimod");
const RUNTIME = join(__dirname, ".runtime.json");

const env = { ...process.env, PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH}` };

async function waitForRpc(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`anvil did not come up on ${url}`);
}

let anvil: ChildProcess;

export default async function setup(): Promise<() => void> {
  anvil = spawn("anvil", ["--port", String(PORT), "--code-size-limit", "100000", "--chain-id", "31338"], {
    env,
    stdio: "ignore",
  });
  await waitForRpc(RPC);

  // Deterministic deploy: same nonces => same addresses => deployments/local.json is reproducible.
  execSync("./script/local-deploy.sh", {
    cwd: UNIMOD,
    env: { ...env, RPC_URL: RPC, FOUNDRY_PROFILE: "deploy" },
    stdio: "pipe",
  });

  const deployments = JSON.parse(readFileSync(join(UNIMOD, "deployments/local.json"), "utf8"));
  writeFileSync(RUNTIME, JSON.stringify({ rpc: RPC, deployments }, null, 2));

  return () => {
    anvil.kill();
  };
}
