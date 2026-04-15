import { getAddress, isAddress } from "viem";

import { AuthError } from "./errors";

export function normalizeWalletAddress(raw: string): string {
  if (!isAddress(raw)) {
    throw new AuthError("INVALID_WALLET", "Invalid wallet address", 400);
  }
  return getAddress(raw).toLowerCase();
}

export function shortenWalletDisplay(lowerAddress: string): string {
  if (lowerAddress.length < 12) {
    return lowerAddress;
  }
  return `${lowerAddress.slice(0, 6)}…${lowerAddress.slice(-4)}`;
}
