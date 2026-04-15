/**
 * Cross-cutting primitive and branded string types for wire formats (JSON APIs).
 * Keep aligned with validation (e.g. Zod) in application code.
 */

/** ISO 8601 date-time string in API payloads (never a JS `Date` on the wire). */
export type IsoDateTimeString = string;

/** ISO 8601 calendar date (YYYY-MM-DD) when time is irrelevant. */
export type IsoDateString = string;

/** EVM address: normalize to lowercase checksumming policy in one place in the app. */
export type WalletAddress = string;

/** `ipfs://…` or gateway URL — canonical form preferred for storage is `ipfs://`. */
export type IpfsUri = string;

/** Non-negative integer as decimal string (token wei, uint256-safe ids from chain). */
export type WeiAmount = string;

/** 0x-prefixed transaction or log-related hash. */
export type TxHash = string;

/** Opaque logical identifiers (CUID/UUID) in JSON. */
export type EntityId = string;
