import "server-only";

import { getIpfsEnv } from "@/lib/ipfs/env";
import { IpfsError } from "@/lib/ipfs/errors";

export type FileValidationInput = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export function validateIpfsFile(input: FileValidationInput): void {
  const env = getIpfsEnv();
  if (!input.fileName.trim()) {
    throw new IpfsError("IPFS_FILE_NAME_REQUIRED", "File name is required");
  }
  if (input.sizeBytes <= 0) {
    throw new IpfsError("IPFS_FILE_EMPTY", "File is empty");
  }
  if (input.sizeBytes > env.IPFS_MAX_FILE_BYTES) {
    throw new IpfsError("IPFS_FILE_TOO_LARGE", "File exceeds IPFS_MAX_FILE_BYTES", 413, {
      maxBytes: env.IPFS_MAX_FILE_BYTES,
      sizeBytes: input.sizeBytes,
    });
  }

  const mime = input.mimeType.trim().toLowerCase();
  if (!mime) {
    throw new IpfsError("IPFS_FILE_MIME_REQUIRED", "MIME type is required");
  }
  if (!env.IPFS_ALLOWED_MIME_TYPES.includes(mime)) {
    throw new IpfsError(
      "IPFS_FILE_TYPE_NOT_ALLOWED",
      `MIME type '${mime}' is not allowed`,
      415,
      { allowed: env.IPFS_ALLOWED_MIME_TYPES },
    );
  }
}

export function validateIpfsJsonSize(sizeBytes: number): void {
  const env = getIpfsEnv();
  if (sizeBytes > env.IPFS_MAX_JSON_BYTES) {
    throw new IpfsError(
      "IPFS_JSON_TOO_LARGE",
      "JSON metadata exceeds IPFS_MAX_JSON_BYTES",
      413,
      { maxBytes: env.IPFS_MAX_JSON_BYTES, sizeBytes },
    );
  }
}
