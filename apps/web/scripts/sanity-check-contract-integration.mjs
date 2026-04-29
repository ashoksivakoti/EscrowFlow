import fs from "node:fs";
import path from "node:path";
import { createPublicClient, http } from "viem";
import { arbitrumSepolia } from "viem/chains";

const CANONICAL_CHAIN_ID = 421614;
const CANONICAL_REGISTRY = "0xe5AF7E2CF6435de6B0a0520518FCaaab851BB40c";
const DEPRECATED_REGISTRY = "0x268993a0E0342972a52C58aa2dD1A9953fd57aCf";

const rootDir = path.resolve(process.cwd());
const metadataPath = path.resolve(rootDir, "config/deployment-metadata.json");
const artifactPath = path.resolve(
  rootDir,
  "../../packages/contracts/artifacts/contracts/EscrowFlowRegistry.sol/EscrowFlowRegistry.json",
);

function fail(message) {
  console.error(`sanity:contract failed: ${message}`);
  process.exit(1);
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    fail(`${name} is required`);
  }
  return value;
}

function lower(value) {
  return value.toLowerCase();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    const raw = trimmed.slice(eqIdx + 1).trim();
    const value = raw.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    process.env[key] = value;
  }
}

function assertNoDeprecatedAddress(sourceName, value) {
  if (!value) {
    return;
  }
  if (lower(value) === lower(DEPRECATED_REGISTRY)) {
    fail(`${sourceName} points to deprecated EscrowFlowRegistry`);
  }
}

function assertAbiContainsRequiredEntries(abi) {
  const requiredFunctions = [
    "createProject",
    "fundProject",
    "submitMilestone",
    "approveMilestone",
    "releaseMilestone",
    "resolveDispute",
    "getProject",
    "getMilestone",
    "projectCount",
    "arbitratorThreshold",
    "arbitratorCount",
    "isAllowedToken",
  ];
  const requiredEvents = ["ProjectCreated", "ProjectFunded"];

  const functionSet = new Set(
    abi.filter((item) => item?.type === "function").map((item) => item.name),
  );
  const eventSet = new Set(
    abi.filter((item) => item?.type === "event").map((item) => item.name),
  );

  for (const fn of requiredFunctions) {
    if (!functionSet.has(fn)) {
      fail(`ABI missing required function: ${fn}`);
    }
  }
  for (const eventName of requiredEvents) {
    if (!eventSet.has(eventName)) {
      fail(`ABI missing required event: ${eventName}`);
    }
  }
}

async function run() {
  loadEnvFile(path.resolve(rootDir, ".env.local"));
  loadEnvFile(path.resolve(rootDir, "../../.env"));

  const metadata = readJson(metadataPath);
  const artifact = readJson(artifactPath);

  const metadataChainId = metadata?.chainId;
  const metadataRegistry = metadata?.contracts?.EscrowFlowRegistry;

  if (metadataChainId !== CANONICAL_CHAIN_ID) {
    fail(`deployment metadata chainId must be ${CANONICAL_CHAIN_ID}`);
  }
  if (lower(metadataRegistry ?? "") !== lower(CANONICAL_REGISTRY)) {
    fail("deployment metadata EscrowFlowRegistry must match canonical address");
  }
  assertNoDeprecatedAddress("deployment metadata EscrowFlowRegistry", metadataRegistry);

  if (!Array.isArray(artifact?.abi)) {
    fail("EscrowFlowRegistry artifact ABI is missing");
  }
  assertAbiContainsRequiredEntries(artifact.abi);

  const rpcUrl = requiredEnv("EVENT_SYNC_RPC_URL");
  const envChainId = Number(process.env.EVENT_SYNC_CHAIN_ID ?? metadataChainId);
  const envRegistry = (process.env.EVENT_SYNC_CONTRACT_ADDRESS ?? metadataRegistry ?? "").trim();
  const configuredToken =
    process.env.CONTRACTS_PAYMENT_TOKEN_ADDRESS?.trim() ??
    process.env.NEXT_PUBLIC_DEFAULT_PAYMENT_TOKEN_ADDRESS?.trim() ??
    "";

  if (!Number.isInteger(envChainId) || envChainId <= 0) {
    fail("EVENT_SYNC_CHAIN_ID must be a positive integer");
  }
  if (envChainId !== CANONICAL_CHAIN_ID) {
    fail(`EVENT_SYNC_CHAIN_ID must be ${CANONICAL_CHAIN_ID}`);
  }
  if (!envRegistry) {
    fail("EVENT_SYNC_CONTRACT_ADDRESS is required");
  }
  if (lower(envRegistry) !== lower(CANONICAL_REGISTRY)) {
    fail("EVENT_SYNC_CONTRACT_ADDRESS must match canonical EscrowFlowRegistry");
  }

  assertNoDeprecatedAddress("EVENT_SYNC_CONTRACT_ADDRESS", process.env.EVENT_SYNC_CONTRACT_ADDRESS);
  assertNoDeprecatedAddress("CONTRACTS_ESCROW_REGISTRY_ADDRESS", process.env.CONTRACTS_ESCROW_REGISTRY_ADDRESS);
  assertNoDeprecatedAddress(
    "NEXT_PUBLIC_DEFAULT_ESCROW_REGISTRY_ADDRESS",
    process.env.NEXT_PUBLIC_DEFAULT_ESCROW_REGISTRY_ADDRESS,
  );

  if (!configuredToken) {
    fail(
      "Configured token is required (set CONTRACTS_PAYMENT_TOKEN_ADDRESS or NEXT_PUBLIC_DEFAULT_PAYMENT_TOKEN_ADDRESS)",
    );
  }

  const client = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(rpcUrl),
  });

  const rpcChainId = await client.getChainId();
  if (rpcChainId !== CANONICAL_CHAIN_ID) {
    fail(`RPC chainId mismatch: expected ${CANONICAL_CHAIN_ID}, got ${rpcChainId}`);
  }

  const projectCount = await client.readContract({
    address: CANONICAL_REGISTRY,
    abi: artifact.abi,
    functionName: "projectCount",
  });
  const threshold = await client.readContract({
    address: CANONICAL_REGISTRY,
    abi: artifact.abi,
    functionName: "arbitratorThreshold",
  });
  const arbitratorCount = await client.readContract({
    address: CANONICAL_REGISTRY,
    abi: artifact.abi,
    functionName: "arbitratorCount",
  });
  const tokenAllowed = await client.readContract({
    address: CANONICAL_REGISTRY,
    abi: artifact.abi,
    functionName: "isAllowedToken",
    args: [configuredToken],
  });

  console.log("sanity:contract passed");
  console.log(
    JSON.stringify(
      {
        chainId: rpcChainId,
        registry: CANONICAL_REGISTRY,
        projectCount: projectCount.toString(),
        arbitratorThreshold: threshold.toString(),
        arbitratorCount: arbitratorCount.toString(),
        token: configuredToken,
        isAllowedToken: tokenAllowed,
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
