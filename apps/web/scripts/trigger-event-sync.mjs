import fs from "node:fs";
import path from "node:path";

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), "../../.env"));

const baseUrl =
  process.env.EVENT_SYNC_INTERNAL_URL?.trim() || "http://127.0.0.1:3000";
const endpoint = `${baseUrl.replace(/\/+$/, "")}/api/internal/event-sync`;
const retries = Number.parseInt(process.env.EVENT_SYNC_TRIGGER_RETRIES ?? "2", 10);
const retryDelayMs = Number.parseInt(
  process.env.EVENT_SYNC_TRIGGER_RETRY_DELAY_MS ?? "1200",
  10,
);

const headers = {};
if (process.env.EVENT_SYNC_TRIGGER_TOKEN) {
  headers["x-event-sync-token"] = process.env.EVENT_SYNC_TRIGGER_TOKEN;
}

let attempt = 0;
while (attempt <= retries) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      cache: "no-store",
    });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`event-sync HTTP ${response.status}: ${bodyText}`);
    }
    console.log(bodyText || `event-sync triggered (attempt ${attempt + 1})`);
    process.exit(0);
  } catch (error) {
    if (attempt >= retries) {
      console.error(
        `event-sync trigger failed after ${attempt + 1} attempts: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
    attempt += 1;
  }
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
