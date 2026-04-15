import "server-only";

import type { IpfsUri } from "@escrowflow/types";

import { getIpfsEnv } from "@/lib/ipfs/env";
import { IpfsError } from "@/lib/ipfs/errors";

const CID_V0_REGEX = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CID_V1_REGEX = /^b[a-z2-7]{20,}$/;

type ParsedIpfsUri = {
  cid: string;
  path: string;
};

export function isValidCid(value: string): boolean {
  return CID_V0_REGEX.test(value) || CID_V1_REGEX.test(value);
}

export function toIpfsUri(cid: string, path = ""): IpfsUri {
  if (!isValidCid(cid)) {
    throw new IpfsError("IPFS_INVALID_CID", "Invalid CID");
  }
  const normalizedPath = sanitizeIpfsPath(path);
  return normalizedPath ? (`ipfs://${cid}/${normalizedPath}` as IpfsUri) : (`ipfs://${cid}` as IpfsUri);
}

export function cidFromIpfsUri(uri: string): string {
  const parsed = parseIpfsUri(uri);
  return parsed.cid;
}

export function parseIpfsUri(uri: string): ParsedIpfsUri {
  if (!uri.startsWith("ipfs://")) {
    throw new IpfsError("IPFS_URI_INVALID_SCHEME", "IPFS URI must start with ipfs://");
  }
  const raw = uri.slice("ipfs://".length).replace(/^\/+/, "");
  const [cid, ...pathParts] = raw.split("/");
  if (!cid || !isValidCid(cid)) {
    throw new IpfsError("IPFS_INVALID_CID", "IPFS URI CID is invalid");
  }
  return {
    cid,
    path: sanitizeIpfsPath(pathParts.join("/")),
  };
}

export function toGatewayUrl(value: string): string {
  const env = getIpfsEnv();
  const parsed = value.startsWith("ipfs://")
    ? parseIpfsUri(value)
    : { cid: value, path: "" };
  if (!isValidCid(parsed.cid)) {
    throw new IpfsError("IPFS_INVALID_CID", "Invalid CID");
  }
  const url = new URL(`https://${env.IPFS_GATEWAY_HOST}`);
  url.pathname = parsed.path
    ? `/ipfs/${parsed.cid}/${encodePath(parsed.path)}`
    : `/ipfs/${parsed.cid}`;
  return url.toString();
}

function sanitizeIpfsPath(path: string): string {
  const normalized = path.replace(/^\/+/, "").trim();
  if (!normalized) {
    return "";
  }
  const invalid = normalized
    .split("/")
    .some((segment) => !segment || segment === "." || segment === "..");
  if (invalid) {
    throw new IpfsError("IPFS_PATH_INVALID", "Invalid path inside IPFS URI");
  }
  return normalized;
}

function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
