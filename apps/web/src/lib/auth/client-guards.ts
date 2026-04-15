import type { PlatformRole } from "@escrowflow/types";

type RolesHolder = { roles: readonly PlatformRole[] };

/**
 * Users without CLIENT/FREELANCER must finish onboarding, except pure ADMIN accounts
 * (e.g. env-bootstrapped operators).
 */
export function needsOnboarding(user: RolesHolder): boolean {
  if (user.roles.includes("ADMIN")) {
    return false;
  }
  return !user.roles.some((r) => r === "CLIENT" || r === "FREELANCER");
}
