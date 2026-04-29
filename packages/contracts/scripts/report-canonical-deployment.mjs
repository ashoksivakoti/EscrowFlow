#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const registry = (process.env.CANONICAL_ESCROW_REGISTRY_ADDRESS ?? "").trim().toLowerCase();
const network = (process.env.CANONICAL_NETWORK_NAME ?? "").trim();
const chainId = Number(process.env.CANONICAL_CHAIN_ID ?? "0");

const deploymentsDir = path.join(root, "deployments");
let deploymentArtifact = null;

if (network && chainId) {
  const candidate = path.join(deploymentsDir, `${network}-${chainId}.json`);
  if (fs.existsSync(candidate)) {
    deploymentArtifact = JSON.parse(fs.readFileSync(candidate, "utf8"));
  }
}

const report = {
  canonicalRegistry: registry || null,
  network: network || deploymentArtifact?.network || null,
  chainId: chainId || deploymentArtifact?.chainId || null,
  deployer: deploymentArtifact?.deployer ?? null,
  deployedAt: deploymentArtifact?.deployedAt ?? null,
  roles: deploymentArtifact?.roles ?? null,
  notes: deploymentArtifact?.notes ?? null,
  commands: {
    compile: "pnpm --filter @escrowflow/contracts compile",
    strictTests: "pnpm --filter @escrowflow/contracts test:strict",
    deploy:
      "pnpm --filter @escrowflow/contracts deploy:canonical:registry -- --network <network>",
    setup:
      "pnpm --filter @escrowflow/contracts setup:canonical:registry -- --network <network>",
    sanity:
      "pnpm --filter @escrowflow/contracts sanity:canonical:registry -- --network <network>",
    verify:
      "pnpm --filter @escrowflow/contracts verify:canonical:registry -- --network <network>",
    cutoverAudit:
      "pnpm --filter @escrowflow/contracts cutover:registry:refs",
  },
};

console.log(JSON.stringify(report, null, 2));
