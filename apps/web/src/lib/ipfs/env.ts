import "server-only";

import { z } from "zod";

const schema = z.object({
  IPFS_PINATA_JWT: z.string().min(1, "IPFS_PINATA_JWT is required"),
  IPFS_PINATA_API_BASE_URL: z
    .string()
    .url()
    .default("https://api.pinata.cloud"),
  IPFS_GATEWAY_HOST: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9.-]+$/, "IPFS_GATEWAY_HOST must be a bare hostname")
    .default("gateway.pinata.cloud"),
  IPFS_MAX_FILE_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  IPFS_MAX_JSON_BYTES: z.coerce.number().int().positive().default(1 * 1024 * 1024),
  IPFS_ALLOWED_MIME_TYPES: z
    .string()
    .default(
      [
        "application/pdf",
        "application/json",
        "text/plain",
        "text/markdown",
        "image/png",
        "image/jpeg",
        "image/webp",
      ].join(","),
    )
    .transform((raw) =>
      raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    )
    .pipe(z.array(z.string()).min(1)),
  IPFS_UPLOAD_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(30_000),
});

export type IpfsEnv = z.infer<typeof schema>;

let cached: IpfsEnv | null = null;

export function getIpfsEnv(): IpfsEnv {
  if (cached) {
    return cached;
  }
  cached = schema.parse({
    IPFS_PINATA_JWT: process.env.IPFS_PINATA_JWT,
    IPFS_PINATA_API_BASE_URL: process.env.IPFS_PINATA_API_BASE_URL,
    IPFS_GATEWAY_HOST: process.env.IPFS_GATEWAY_HOST,
    IPFS_MAX_FILE_BYTES: process.env.IPFS_MAX_FILE_BYTES,
    IPFS_MAX_JSON_BYTES: process.env.IPFS_MAX_JSON_BYTES,
    IPFS_ALLOWED_MIME_TYPES: process.env.IPFS_ALLOWED_MIME_TYPES,
    IPFS_UPLOAD_TIMEOUT_MS: process.env.IPFS_UPLOAD_TIMEOUT_MS,
  });
  return cached;
}

export function resetIpfsEnvCacheForTests(): void {
  cached = null;
}
