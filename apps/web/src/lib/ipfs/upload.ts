import "server-only";

import type { IpfsUri } from "@escrowflow/types";

import { getIpfsEnv } from "@/lib/ipfs/env";
import { IpfsError } from "@/lib/ipfs/errors";
import { toGatewayUrl, toIpfsUri } from "@/lib/ipfs/gateway";
import { validateIpfsFile, validateIpfsJsonSize } from "@/lib/ipfs/validation";

type PinataResponse = {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
  isDuplicate?: boolean;
};

export type IpfsUploadResult = {
  cid: string;
  uri: IpfsUri;
  gatewayUrl: string;
  sizeBytes: number;
  contentType: string;
};

export type IpfsFileUploadInput = {
  file:
    | File
    | Blob
    | Buffer
    | Uint8Array
    | ArrayBuffer
    | { data: Uint8Array | Buffer | ArrayBuffer; mimeType: string };
  fileName: string;
  mimeType?: string;
  metadataName?: string;
  keyvalues?: Record<string, string>;
};

export async function uploadFileToIpfs(input: IpfsFileUploadInput): Promise<IpfsUploadResult> {
  const env = getIpfsEnv();
  const normalized = normalizeFileInput(input.file, input.mimeType);
  validateIpfsFile({
    fileName: input.fileName,
    mimeType: normalized.mimeType,
    sizeBytes: normalized.sizeBytes,
  });

  const formData = new FormData();
  formData.append("file", normalized.blob, input.fileName);
  if (input.metadataName || input.keyvalues) {
    formData.append(
      "pinataMetadata",
      JSON.stringify({
        name: input.metadataName ?? input.fileName,
        keyvalues: input.keyvalues ?? {},
      }),
    );
  }

  const response = await pinataRequest("/pinning/pinFileToIPFS", {
    method: "POST",
    body: formData,
    timeoutMs: env.IPFS_UPLOAD_TIMEOUT_MS,
  });

  const uri = toIpfsUri(response.IpfsHash);
  return {
    cid: response.IpfsHash,
    uri,
    gatewayUrl: toGatewayUrl(uri),
    sizeBytes: normalized.sizeBytes,
    contentType: normalized.mimeType,
  };
}

export async function uploadJsonToIpfs<T extends Record<string, unknown>>(
  payload: T,
  opts?: { metadataName?: string; keyvalues?: Record<string, string> },
): Promise<IpfsUploadResult> {
  const env = getIpfsEnv();
  const body = JSON.stringify({
    pinataContent: payload,
    pinataMetadata: {
      name: opts?.metadataName ?? "escrowflow-metadata",
      keyvalues: opts?.keyvalues ?? {},
    },
  });
  const sizeBytes = Buffer.byteLength(body, "utf8");
  validateIpfsJsonSize(sizeBytes);

  const response = await pinataRequest("/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body,
    timeoutMs: env.IPFS_UPLOAD_TIMEOUT_MS,
  });

  const uri = toIpfsUri(response.IpfsHash);
  return {
    cid: response.IpfsHash,
    uri,
    gatewayUrl: toGatewayUrl(uri),
    sizeBytes,
    contentType: "application/json",
  };
}

async function pinataRequest(
  endpointPath: string,
  init: RequestInit & { timeoutMs: number },
): Promise<PinataResponse> {
  const env = getIpfsEnv();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    const url = `${env.IPFS_PINATA_API_BASE_URL}${endpointPath}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${env.IPFS_PINATA_JWT}`,
        ...(init.headers ?? {}),
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    const data = safeJson(text);
    if (!response.ok) {
      throw new IpfsError(
        "IPFS_UPLOAD_FAILED",
        `IPFS upload failed (${response.status})`,
        response.status,
        { endpointPath, data },
      );
    }
    if (!isPinataResponse(data)) {
      throw new IpfsError("IPFS_UPLOAD_INVALID_RESPONSE", "Unexpected IPFS upload response");
    }
    return data;
  } catch (error) {
    if (error instanceof IpfsError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new IpfsError("IPFS_UPLOAD_TIMEOUT", "IPFS upload timed out", 504);
    }
    throw new IpfsError("IPFS_UPLOAD_UNKNOWN_ERROR", "Unexpected IPFS upload failure", 500);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeFileInput(
  input: IpfsFileUploadInput["file"],
  explicitMimeType?: string,
): { blob: Blob; mimeType: string; sizeBytes: number } {
  const fallbackMime = (explicitMimeType ?? "application/octet-stream").toLowerCase();
  if (input instanceof File || input instanceof Blob) {
    const mimeType = (explicitMimeType ?? input.type ?? fallbackMime).toLowerCase();
    return { blob: input, mimeType, sizeBytes: input.size };
  }
  if (isBinaryWrapper(input)) {
    const bytes = toUint8Array(input.data);
    const blob = new Blob([Buffer.from(bytes)], { type: input.mimeType });
    return {
      blob,
      mimeType: (explicitMimeType ?? input.mimeType).toLowerCase(),
      sizeBytes: bytes.byteLength,
    };
  }
  const bytes = toUint8Array(input);
  const blob = new Blob([Buffer.from(bytes)], { type: fallbackMime });
  return { blob, mimeType: fallbackMime, sizeBytes: bytes.byteLength };
}

function toUint8Array(input: Uint8Array | ArrayBuffer): Uint8Array {
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  return input;
}

function isBinaryWrapper(
  input: unknown,
): input is { data: Uint8Array | Buffer | ArrayBuffer; mimeType: string } {
  if (!input || typeof input !== "object") {
    return false;
  }
  const maybe = input as { data?: unknown; mimeType?: unknown };
  return (
    typeof maybe.mimeType === "string" &&
    (maybe.data instanceof Uint8Array ||
      maybe.data instanceof ArrayBuffer ||
      Buffer.isBuffer(maybe.data))
  );
}

function isPinataResponse(data: unknown): data is PinataResponse {
  if (!data || typeof data !== "object") {
    return false;
  }
  const maybe = data as Record<string, unknown>;
  return typeof maybe.IpfsHash === "string" && typeof maybe.PinSize === "number";
}

function safeJson(text: string): unknown {
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}
