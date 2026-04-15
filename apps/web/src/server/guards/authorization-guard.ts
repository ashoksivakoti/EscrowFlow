import type { PlatformRole, SessionUser } from "@escrowflow/types";

import { AppError } from "@/server/errors/app-error";

export function requireRoles(
  session: SessionUser,
  required: PlatformRole | readonly PlatformRole[],
): void {
  const set = new Set(Array.isArray(required) ? required : [required]);
  const hasRole = session.roles.some((role) => set.has(role));
  if (!hasRole) {
    throw AppError.forbidden();
  }
}
