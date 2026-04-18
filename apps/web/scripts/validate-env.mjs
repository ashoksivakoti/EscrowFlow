import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

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
    .regex(/^0x[a-fA-F0-9]{40}$/, "EVENT_SYNC_CONTRACT_ADDRESS must be a valid EVM address"),
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
