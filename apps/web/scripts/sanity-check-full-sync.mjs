import fs from "node:fs";
import path from "node:path";
import { createPublicClient, http } from "viem";
import { arbitrumSepolia } from "viem/chains";

const DEPRECATED_REGISTRY = "0x268993a0E0342972a52C58aa2dD1A9953fd57aCf".toLowerCase();

const appRoot = path.resolve(process.cwd());
const repoRoot = path.resolve(appRoot, "../..");
const metadataPath = path.resolve(appRoot, "config/deployment-metadata.json");
const eventSyncServicePath = path.resolve(
  appRoot,
  "src/server/services/event-sync-service.ts",
);

function fail(message) {
  console.error(`sanity:full-sync failed: ${message}`);
  process.exit(1);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    if (!key || process.env[key] !== undefined) continue;
    const raw = trimmed.slice(idx + 1).trim();
    process.env[key] = raw.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
}

function loadMetadata() {
  const parsed = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  const chainId = Number(parsed?.chainId);
  const deploymentBlock = Number(parsed?.deploymentBlock);
  const registry = String(parsed?.contracts?.EscrowFlowRegistry ?? "").toLowerCase();
  const abiSource = String(parsed?.abi?.source ?? "");
  if (!Number.isInteger(chainId) || !Number.isInteger(deploymentBlock) || !abiSource) {
    fail("deployment metadata is missing chainId/deploymentBlock/abi.source");
  }
  if (!/^0x[a-f0-9]{40}$/.test(registry)) {
    fail("deployment metadata EscrowFlowRegistry is invalid");
  }
  return { chainId, deploymentBlock, registry, abiSource };
}

function extractEventSyncNames() {
  const source = fs.readFileSync(eventSyncServicePath, "utf8");
  const requiredMatch = source.match(
    /export const REQUIRED_EVENT_NAMES = \[([\s\S]*?)\] as const;/m,
  );
  const optionalMatch = source.match(
    /export const OPTIONAL_EVENT_NAMES = \[([\s\S]*?)\] as const;/m,
  );
  if (!requiredMatch || !optionalMatch) {
    fail("could not parse REQUIRED/OPTIONAL event names from event-sync-service.ts");
  }
  const toNames = (block) =>
    Array.from(block.matchAll(/"([^"]+)"/g)).map((m) => m[1]);
  return {
    required: toNames(requiredMatch[1]),
    optional: toNames(optionalMatch[1]),
  };
}

function assertNoDeprecatedRuntimeAddress(envName, value) {
  if (!value) return;
  if (String(value).toLowerCase() === DEPRECATED_REGISTRY) {
    fail(`${envName} points to deprecated registry`);
  }
}

function getDatabaseUrlOrFail() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    fail(
      "DATABASE_URL is required for sanity:full-sync (needs live DB access for checkpoint/log validation)",
    );
  }
  return databaseUrl;
}

function describeDbTarget(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    return `${parsed.hostname}:${parsed.port || "(default)"}/${parsed.pathname.replace(/^\//, "")}`;
  } catch {
    return "unparseable DATABASE_URL";
  }
}

async function run() {
  loadEnvFile(path.resolve(appRoot, ".env.local"));
  loadEnvFile(path.resolve(repoRoot, ".env"));

  const metadata = loadMetadata();
  const abiPath = path.resolve(repoRoot, metadata.abiSource);
  if (!fs.existsSync(abiPath)) {
    fail(`ABI artifact not found at ${abiPath}`);
  }
  const artifact = JSON.parse(fs.readFileSync(abiPath, "utf8"));
  const abi = artifact?.abi;
  if (!Array.isArray(abi)) {
    fail("artifact ABI is missing");
  }

  // 1, 2, 3: canonical config checks
  if (metadata.chainId !== 421614) {
    fail(`metadata chainId must be 421614, got ${metadata.chainId}`);
  }
  if (
    metadata.registry !==
    "0xe5af7e2cf6435de6b0a0520518fcaaab851bb40c"
  ) {
    fail("metadata canonical registry mismatch");
  }
  const startBlock = Number(
    process.env.EVENT_SYNC_START_BLOCK ?? metadata.deploymentBlock,
  );
  if (startBlock !== metadata.deploymentBlock) {
    fail(
      `EVENT_SYNC_START_BLOCK mismatch: expected ${metadata.deploymentBlock}, got ${startBlock}`,
    );
  }

  const configuredChainId = Number(process.env.EVENT_SYNC_CHAIN_ID ?? metadata.chainId);
  const configuredRegistry = String(
    process.env.EVENT_SYNC_CONTRACT_ADDRESS ?? metadata.registry,
  ).toLowerCase();
  if (configuredChainId !== metadata.chainId) {
    fail(
      `EVENT_SYNC_CHAIN_ID mismatch: expected ${metadata.chainId}, got ${configuredChainId}`,
    );
  }
  if (configuredRegistry !== metadata.registry) {
    fail("EVENT_SYNC_CONTRACT_ADDRESS must match deployment metadata canonical address");
  }

  // 8: deprecated runtime references
  assertNoDeprecatedRuntimeAddress(
    "EVENT_SYNC_CONTRACT_ADDRESS",
    process.env.EVENT_SYNC_CONTRACT_ADDRESS,
  );
  assertNoDeprecatedRuntimeAddress(
    "CONTRACTS_ESCROW_REGISTRY_ADDRESS",
    process.env.CONTRACTS_ESCROW_REGISTRY_ADDRESS,
  );
  assertNoDeprecatedRuntimeAddress(
    "NEXT_PUBLIC_DEFAULT_ESCROW_REGISTRY_ADDRESS",
    process.env.NEXT_PUBLIC_DEFAULT_ESCROW_REGISTRY_ADDRESS,
  );

  const rpcUrl = process.env.EVENT_SYNC_RPC_URL?.trim();
  if (!rpcUrl) {
    fail("EVENT_SYNC_RPC_URL is required");
  }
  const client = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(rpcUrl),
  });
  const rpcChainId = await client.getChainId();
  if (rpcChainId !== metadata.chainId) {
    fail(`RPC chain mismatch: expected ${metadata.chainId}, got ${rpcChainId}`);
  }

  // 4,5,6 on-chain read checks
  await client.readContract({
    address: metadata.registry,
    abi,
    functionName: "projectCount",
  });
  await client.readContract({
    address: metadata.registry,
    abi,
    functionName: "paused",
  });
  await client.readContract({
    address: metadata.registry,
    abi,
    functionName: "arbitratorCount",
  });
  await client.readContract({
    address: metadata.registry,
    abi,
    functionName: "arbitratorThreshold",
  });

  // 9: event set parity (required includes Paused/Unpaused and all ABI events)
  const syncNames = extractEventSyncNames();
  const requiredSet = new Set(syncNames.required);
  if (!requiredSet.has("Paused") || !requiredSet.has("Unpaused")) {
    fail("REQUIRED_EVENT_NAMES must include Paused and Unpaused");
  }
  const supportedSet = new Set([...syncNames.required, ...syncNames.optional]);
  const abiEvents = abi
    .filter((item) => item?.type === "event")
    .map((item) => item.name);
  const missingEvents = abiEvents.filter((name) => !supportedSet.has(name));
  if (missingEvents.length > 0) {
    fail(`event-sync missing ABI events: ${missingEvents.join(", ")}`);
  }

  // DB checks
  const databaseUrl = getDatabaseUrlOrFail();
  const dbTarget = describeDbTarget(databaseUrl);
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    try {
      await prisma.$connect();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      fail(
        [
          `database is unreachable at ${dbTarget}`,
          "Ensure DATABASE_URL points to a reachable Postgres in CI/release.",
          "Run migrations before sanity gate (pnpm db:migrate:deploy).",
          `Driver error: ${reason}`,
        ].join(" "),
      );
    }

    // 7 checkpoint at/after deployment block
    const scope = `ESCROW_REGISTRY:${metadata.registry}`;
    const checkpoint = await prisma.eventSyncCheckpoint.findUnique({
      where: { chainId_scope: { chainId: metadata.chainId, scope } },
      select: { lastProcessedBlock: true },
    });
    if (!checkpoint) {
      fail("event sync checkpoint not found for canonical scope");
    }
    if (checkpoint.lastProcessedBlock < BigInt(metadata.deploymentBlock)) {
      fail(
        `event sync checkpoint is behind deployment block (${checkpoint.lastProcessedBlock} < ${metadata.deploymentBlock})`,
      );
    }

    // 10 synthetic vs chain log distinguishability
    const [invalidChainRows, invalidSyntheticRows] = await Promise.all([
      prisma.transactionLog.count({
        where: { sourceType: "chain_event", logIndex: { lt: 0 } },
      }),
      prisma.transactionLog.count({
        where: { sourceType: { not: "chain_event" }, logIndex: { gte: 0 } },
      }),
    ]);
    if (invalidChainRows > 0) {
      fail("found chain_event rows with negative logIndex");
    }
    if (invalidSyntheticRows > 0) {
      fail("found non-chain rows with indexed (>=0) logIndex");
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log("sanity:full-sync passed");
  console.log(
    JSON.stringify(
      {
        chainId: metadata.chainId,
        registry: metadata.registry,
        deploymentBlock: metadata.deploymentBlock,
        eventSyncStartBlock: startBlock,
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
