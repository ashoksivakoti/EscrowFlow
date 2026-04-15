/**
 * Wallet authentication (SIWE) and session helpers.
 *
 * - **Authentication** (`session`, `guards`): who is this caller?
 * - **Authorization**: use `authorizePlatformRoles` plus domain checks (project membership, etc.).
 *
 * See `docs/auth.md` for the full flow.
 */

export {
  authenticateRequest,
  authorizePlatformRoles,
  requireSession,
  requireSessionWithRoles,
} from "./guards";
export type { AuthedContext } from "./guards";

export {
  getSessionUserFromRequest,
  getServerSessionUser,
  clearSessionCookieHeader,
} from "./session";

export { getAuthEnv, resetAuthEnvCacheForTests } from "./env";
