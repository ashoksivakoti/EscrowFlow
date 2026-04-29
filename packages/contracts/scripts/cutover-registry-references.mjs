#!/usr/bin/env node
/**
 * Canonical cutover helper:
 * 1) Optionally replace deprecated registry addresses with CANONICAL_ESCROW_REGISTRY_ADDRESS.
 * 2) Report all files referencing common registry env keys/constants.
 *
 * Env:
 *   CANONICAL_ESCROW_REGISTRY_ADDRESS=0x...
 *   DEPRECATED_ESCROW_REGISTRY_ADDRESSES=0xOld1,0xOld2
 *   APPLY_CHANGES=true   (default false -> dry run)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const apply = String(process.env.APPLY_CHANGES ?? "false").toLowerCase() === "true";
const canonical = (process.env.CANONICAL_ESCROW_REGISTRY_ADDRESS ?? "").trim();
const deprecated = (process.env.DEPRECATED_ESCROW_REGISTRY_ADDRESSES ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const KEY_PATTERNS = [
  "ESCROW_FLOW_REGISTRY",
  "ESCROW_REGISTRY",
  "REGISTRY_ADDRESS",
  "CONTRACT_ADDRESS",
  "ESCROW_CONTRACT_ADDRESS",
  "NEXT_PUBLIC_ESCROW",
  "VITE_ESCROW",
  "REACT_APP_ESCROW",
  "SUBGRAPH",
  "GRAPH",
  "INDEXER",
  "PROXY",
  "IMPLEMENTATION",
  "DEPLOYED_ADDRESS",
  "EscrowFlowRegistry",
];

const INCLUDE_EXTENSIONS = new Set([
  ".env",
  ".json",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".md",
  ".yml",
  ".yaml",
]);

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  "artifacts",
  "cache",
  "typechain-types",
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
      continue;
    }
    const full = path.join(dir, entry.name);
    const ext = path.extname(entry.name);
    if (
      entry.name.startsWith(".env") ||
      INCLUDE_EXTENSIONS.has(ext) ||
      entry.name === ".env"
    ) {
      out.push(full);
    }
  }
  return out;
}

function isProbablyText(contents) {
  return !contents.includes("\u0000");
}

function relative(file) {
  return path.relative(repoRoot, file) || file;
}

const files = walk(repoRoot);
const keyHits = [];
const deprecatedHits = [];

for (const file of files) {
  const raw = fs.readFileSync(file, "utf8");
  if (!isProbablyText(raw)) continue;

  let matchedKey = false;
  for (const pattern of KEY_PATTERNS) {
    if (raw.includes(pattern)) {
      matchedKey = true;
      break;
    }
  }
  if (matchedKey) {
    keyHits.push(relative(file));
  }

  if (deprecated.length > 0) {
    let next = raw;
    let changed = false;
    for (const oldAddress of deprecated) {
      if (!oldAddress) continue;
      if (next.includes(oldAddress)) {
        deprecatedHits.push({ file: relative(file), oldAddress });
        if (canonical) {
          next = next.split(oldAddress).join(canonical);
          changed = true;
        }
      }
    }
    if (apply && changed && canonical) {
      fs.writeFileSync(file, next, "utf8");
    }
  }
}

console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "dry-run",
      canonicalAddress: canonical || null,
      deprecatedAddresses: deprecated,
      filesReferencingRegistryKeys: keyHits.sort(),
      deprecatedAddressHits: deprecatedHits,
      note:
        "Review filesReferencingRegistryKeys and update env/config values to the canonical deployment address.",
    },
    null,
    2,
  ),
);
