/**
 * Set on-chain binding fields on a `projects` row so `/projects/:id/funding` can load `ProjectFundingPanel`.
 *
 * Usage (from repo root; requires `DATABASE_URL`):
 *   node prisma/scripts/link-project-on-chain-fields.mjs [projectId] [clientWallet] [onChainProjectId]
 *
 * Defaults (this repo / your session) when args omitted:
 *   projectId          → env LINK_PROJECT_ID or cmo41nhpj0005tn6bday5mbzi
 *   clientWallet       → env LINK_CLIENT_WALLET or 0x622a2d34f241D19726E27bf55Be3c255b2f7BDB4
 *   onChainProjectId   → env LINK_ON_CHAIN_PROJECT_ID or "1" (registry uses ids starting at 1)
 *
 * Chain / contract defaults (first non-empty wins):
 *   env CONTRACTS_DEFAULT_CHAIN_ID, CONTRACTS_ESCROW_REGISTRY_ADDRESS, CONTRACTS_PAYMENT_TOKEN_ADDRESS
 *   or `packages/contracts/deployments/hardhat-31337.json` (override path with CONTRACTS_DEPLOYMENT_PATH)
 *
 * Loads `.env`, `.env.local` (repo root), then `apps/web/.env.local` when present (same pattern as other prisma scripts).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "../..");

function loadDotEnvFiles(paths) {
  for (const rel of paths) {
    try {
      const p = resolve(repoRoot, rel);
      if (!existsSync(p)) continue;
      const raw = readFileSync(p, "utf8");
      for (const line of raw.split("\n")) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!m) continue;
        const key = m[1];
        let val = m[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    } catch {
      // optional
    }
  }
}

loadDotEnvFiles([".env", ".env.local", "apps/web/.env.local", "apps/web/.env"]);

function normalizeWallet(raw) {
  const s = String(raw).trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(s)) {
    throw new Error(`Invalid EVM address: ${raw}`);
  }
  return s.toLowerCase();
}

function isEvmAddress(s) {
  return typeof s === "string" && /^0x[a-fA-F0-9]{40}$/i.test(s);
}

function readDeploymentArtifact(relPath) {
  const p = resolve(repoRoot, relPath);
  if (!existsSync(p)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function resolveContractDefaults() {
  const explicitPath = process.env.CONTRACTS_DEPLOYMENT_PATH?.trim();
  const rel = explicitPath || "packages/contracts/deployments/hardhat-31337.json";
  const artifact = readDeploymentArtifact(rel);
  const chainId = Number(process.env.CONTRACTS_DEFAULT_CHAIN_ID || artifact?.chainId);
  const escrow =
    (process.env.CONTRACTS_ESCROW_REGISTRY_ADDRESS || artifact?.contracts?.EscrowFlowRegistry || "").trim();
  const token =
    (process.env.CONTRACTS_PAYMENT_TOKEN_ADDRESS || artifact?.contracts?.MockERC20Stablecoin || "").trim();

  if (!Number.isFinite(chainId) || chainId <= 0) {
    throw new Error("Could not resolve chainId (set CONTRACTS_DEFAULT_CHAIN_ID or use a deployment JSON with chainId).");
  }
  if (!isEvmAddress(escrow)) {
    throw new Error("Could not resolve escrow registry address (set CONTRACTS_ESCROW_REGISTRY_ADDRESS or deployment artifact).");
  }
  if (!isEvmAddress(token)) {
    throw new Error("Could not resolve payment token address (set CONTRACTS_PAYMENT_TOKEN_ADDRESS or deployment artifact).");
  }

  return {
    chainId,
    escrowContractAddress: escrow.toLowerCase(),
    paymentTokenAddress: token.toLowerCase(),
  };
}

function sumMilestoneWei(milestones) {
  let sum = 0n;
  for (const m of milestones) {
    const w = String(m.amountWei || "").trim();
    if (!/^\d+$/.test(w)) {
      throw new Error(`Invalid milestone amountWei on milestone ${m.id}: ${m.amountWei}`);
    }
    sum += BigInt(w);
  }
  return sum.toString();
}

const projectId =
  process.argv[2] || process.env.LINK_PROJECT_ID || "cmo41nhpj0005tn6bday5mbzi";
const clientWallet = normalizeWallet(
  process.argv[3] || process.env.LINK_CLIENT_WALLET || "0x622a2d34f241D19726E27bf55Be3c255b2f7BDB4",
);
const onChainProjectId = String(
  process.argv[4] || process.env.LINK_ON_CHAIN_PROJECT_ID || "1",
).trim();

if (!/^\d+$/.test(onChainProjectId)) {
  throw new Error(`onChainProjectId must be a decimal uint256 string, got: ${onChainProjectId}`);
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set (add it to repo root .env).");
}

const prisma = new PrismaClient();

async function main() {
  const contracts = resolveContractDefaults();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      client: { select: { id: true, walletAddress: true } },
      milestones: { select: { id: true, amountWei: true, sortOrder: true } },
    },
  });

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const dbClient = project.client.walletAddress.toLowerCase();
  if (dbClient !== clientWallet) {
    throw new Error(
      `Client wallet mismatch. Expected project owner ${dbClient}, script was given ${clientWallet}.`,
    );
  }

  if (project.milestones.length === 0) {
    throw new Error("Project has no milestones; cannot derive totalValueWei.");
  }

  const totalValueWei = sumMilestoneWei(project.milestones);

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      chainId: contracts.chainId,
      escrowContractAddress: contracts.escrowContractAddress,
      paymentTokenAddress: contracts.paymentTokenAddress,
      onChainProjectId,
      totalValueWei,
    },
    select: {
      id: true,
      title: true,
      status: true,
      chainId: true,
      escrowContractAddress: true,
      paymentTokenAddress: true,
      onChainProjectId: true,
      totalValueWei: true,
    },
  });

  // eslint-disable-next-line no-console
  console.log("Updated project on-chain binding fields:", JSON.stringify(updated, null, 2));
  // eslint-disable-next-line no-console
  console.log(
    "\nNote: Funding txs only succeed if this onChainProjectId matches a project created on that registry for this client, with matching totals.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
