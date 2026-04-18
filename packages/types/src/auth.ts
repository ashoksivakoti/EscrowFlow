import type { IsoDateTimeString, WalletAddress } from "./primitives";
import type { PlatformRole } from "./enums";
import type { ProfilePublic } from "./profile";

/**
 * Wallet session after SIWE verification (opaque to clients beyond claims below).
 */

export type AuthNonceResponse = {
  nonce: string;
  /** Echo for clients building SIWE messages (e.g. chainId, statement). */
  siwe: {
    domain: string;
    uri: string;
    /** Suggested default chain for the client UI; must be one of `chainIdsAllowed`. */
    chainId: number;
    /** Every EIP-155 chain id accepted by `POST .../siwe/verify`. */
    chainIdsAllowed: number[];
    statement?: string;
    expirationMinutes?: number;
  };
};

export type SiweVerifyRequest = {
  message: string;
  signature: `0x${string}`;
};

export type SessionToken = string;

export type SessionUser = {
  id: string;
  walletAddress: WalletAddress;
  roles: PlatformRole[];
  profile: ProfilePublic | null;
  lastLoginAt: IsoDateTimeString | null;
};

export type SessionResponse = {
  /**
   * Bearer token when using `Authorization` header mode (optional).
   * Default production mode uses an HttpOnly cookie; see docs/auth.md.
   */
  token?: SessionToken;
  expiresAt: IsoDateTimeString;
  user: SessionUser;
  /** True when this verification created a new `User` row (first wallet login). */
  isNewUser: boolean;
};

export type SessionClaims = {
  sub: string;
  walletAddress: WalletAddress;
  roles: PlatformRole[];
  iat?: number;
  exp?: number;
};

export type GetSessionResponse = {
  authenticated: boolean;
  user: SessionUser | null;
};
