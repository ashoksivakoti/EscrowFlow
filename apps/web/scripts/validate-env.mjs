import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

const CANONICAL_CHAIN_ID = 421614;
const CANONICAL_ESCROW_REGISTRY_ADDRESS =
  "0xe5af7e2cf6435de6b0a0520518fcaaab851bb40c";
const CANONICAL_DEPLOYMENT_BLOCK = 263614332;
const DEPRECATED_ESCROW_REGISTRY_ADDRESS =
  "0x268993a0e0342972a52c58aa2dd1a9953fd57acf";

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), "../../.env"));

const schema = z.object({
  NODE_ENV: z.string().optional(),
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
  NEXT_PUBLIC_CHAIN_IDS: z.string().min(1, "NEXT_PUBLIC_CHAIN_IDS is required"),
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: z
    .string()
    .min(1, "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  AUTH_SIWE_DOMAIN: z.string().min(1),
  AUTH_SIWE_URI: z.string().url("AUTH_SIWE_URI must be a valid URL"),
  AUTH_ALLOWED_CHAIN_IDS: z.string().min(1),
  EVENT_SYNC_RPC_URL: z.string().url("EVENT_SYNC_RPC_URL must be a valid URL"),
  EVENT_SYNC_CHAIN_ID: z.coerce.number().int().positive(),
  EVENT_SYNC_CONTRACT_ADDRESS: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{40}$/, "EVENT_SYNC_CONTRACT_ADDRESS must be a valid EVM address")
    .transform((v) => v.toLowerCase())
    .refine(
      (v) => v !== DEPRECATED_ESCROW_REGISTRY_ADDRESS,
      "EVENT_SYNC_CONTRACT_ADDRESS must not use deprecated EscrowFlowRegistry",
    ),
  EVENT_SYNC_SCOPE: z.string().trim().min(1).optional(),
  EVENT_SYNC_START_BLOCK: z.coerce.number().int().positive().optional(),
  EVENT_SYNC_TRIGGER_TOKEN: z
    .string()
    .min(16, "EVENT_SYNC_TRIGGER_TOKEN should be at least 16 chars")
    .optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Environment validation failed for apps/web:");
  for (const issue of parsed.error.issues) {
    console.error(`- ${issue.path.join(".") || "env"}: ${issue.message}`);
  }
  process.exit(1);
}

const warnings = [];
if (process.env.NODE_ENV === "production") {
  if (!process.env.EVENT_SYNC_START_BLOCK?.trim()) {
    console.error(
      "Environment validation failed for apps/web:\n- EVENT_SYNC_START_BLOCK: required in production and must be a positive integer",
    );
    process.exit(1);
  }
  if (Number(process.env.EVENT_SYNC_START_BLOCK) <= 0) {
    console.error(
      "Environment validation failed for apps/web:\n- EVENT_SYNC_START_BLOCK: must be a positive integer in production",
    );
    process.exit(1);
  }
  if (parsed.data.EVENT_SYNC_CHAIN_ID !== CANONICAL_CHAIN_ID) {
    console.error(
      `Environment validation failed for apps/web:\n- EVENT_SYNC_CHAIN_ID: must be ${CANONICAL_CHAIN_ID} in production`,
    );
    process.exit(1);
  }
  if (parsed.data.EVENT_SYNC_CONTRACT_ADDRESS !== CANONICAL_ESCROW_REGISTRY_ADDRESS) {
    console.error(
      "Environment validation failed for apps/web:\n- EVENT_SYNC_CONTRACT_ADDRESS: must match canonical EscrowFlowRegistry in production",
    );
    process.exit(1);
  }
  if (Number(process.env.EVENT_SYNC_START_BLOCK) !== CANONICAL_DEPLOYMENT_BLOCK) {
    console.error(
      `Environment validation failed for apps/web:\n- EVENT_SYNC_START_BLOCK: must be canonical deployment block ${CANONICAL_DEPLOYMENT_BLOCK} in production`,
    );
    process.exit(1);
  }

  if (parsed.data.AUTH_SIWE_URI.startsWith("http://")) {
    warnings.push("AUTH_SIWE_URI uses http:// in production (https:// recommended).");
  }
  if (!process.env.IPFS_PINATA_JWT) {
    warnings.push("IPFS_PINATA_JWT is not set; upload flows will fail.");
  }
  if (!parsed.data.EVENT_SYNC_TRIGGER_TOKEN) {
    warnings.push("EVENT_SYNC_TRIGGER_TOKEN is unset; internal sync endpoint is unprotected.");
  }
}

if (parsed.data.EVENT_SYNC_CONTRACT_ADDRESS !== CANONICAL_ESCROW_REGISTRY_ADDRESS) {
  console.error(
    "Environment validation failed for apps/web:\n- EVENT_SYNC_CONTRACT_ADDRESS: must match canonical EscrowFlowRegistry",
  );
  process.exit(1);
}

const canonicalScope = `ESCROW_REGISTRY:${parsed.data.EVENT_SYNC_CONTRACT_ADDRESS}`;
if (!parsed.data.EVENT_SYNC_SCOPE) {
  warnings.push(`EVENT_SYNC_SCOPE is unset; recommended value: ${canonicalScope}`);
} else if (parsed.data.EVENT_SYNC_SCOPE !== canonicalScope) {
  warnings.push(`EVENT_SYNC_SCOPE should be address-scoped as ${canonicalScope}`);
}

if (warnings.length > 0) {
  console.warn("Environment warnings:");
  for (const warning of warnings) {
    console.warn(`- ${warning}`);
  }
}

console.log("Environment validation passed.");

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
