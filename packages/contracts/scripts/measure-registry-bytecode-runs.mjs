/**
 * Prints deployed runtime bytecode size (bytes) for EscrowFlowRegistry
 * across CONTRACTS_OPTIMIZER_RUNS values. Requires `hardhat compile` per run.
 *
 * Usage: npm run measure:bytecode-runs
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const artifactPath = path.join(
  root,
  "artifacts/contracts/EscrowFlowRegistry.sol/EscrowFlowRegistry.json",
);

const RUNS = [1, 10, 50, 100, 200];
const EIP170 = 24576;
const WARN = 23500;

function deployedRuntimeSizeBytes() {
  const j = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const hex = j.deployedBytecode;
  if (typeof hex !== "string" || !hex.startsWith("0x")) {
    throw new Error("Missing deployedBytecode in artifact");
  }
  return (hex.length - 2) / 2;
}

console.log("EscrowFlowRegistry deployed runtime bytecode (viaIR, bytecodeHash none)\n");
let bestRuns = RUNS[0];
let bestSize = Infinity;

for (const runs of RUNS) {
  execSync("npx hardhat compile --force", {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, CONTRACTS_OPTIMIZER_RUNS: String(runs) },
  });
  const size = deployedRuntimeSizeBytes();
  const margin = EIP170 - size;
  console.log(
    `  runs=${runs}\tdeployed=${size} bytes\tmargin_to_EIP170=${margin}\twarn23500=${size < WARN ? "ok" : "over"}`,
  );
  if (size < bestSize) {
    bestSize = size;
    bestRuns = runs;
  }
}

console.log(`\nSmallest in this sweep: runs=${bestRuns} -> ${bestSize} bytes (EIP170 limit ${EIP170}, warn ${WARN})`);
