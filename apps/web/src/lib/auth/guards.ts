import type { NextResponse } from "next/server";

import type { PlatformRole, SessionUser } from "@escrowflow/types";

import { jsonError } from "@/lib/http/json";

import { getSessionUserFromRequest } from "./session";

/**
 * Authentication: prove *who* is calling (wallet-backed session).
 * See `authorizePlatformRoles` for *what* they may do.
 */

export type AuthedContext = {
  session: SessionUser;
  userId: string;
};

export async function authenticateRequest(
  request: Request,
): Promise<
  { ok: true; context: AuthedContext } | { ok: false; response: NextResponse }
> {
  const session = await getSessionUserFromRequest(request);
  if (!session) {
    return {
      ok: false,
      response: jsonError(401, "UNAUTHENTICATED", "Authentication required"),
    };
  }
  return {
    ok: true,
    context: { session, userId: session.id },
  };
}

/**
 * Authorization: platform-level roles (ADMIN / CLIENT / FREELANCER).
 * Resource-level rules (e.g. project participant) belong in domain services.
 */
export function authorizePlatformRoles(
  session: SessionUser,
  allowed: PlatformRole | readonly PlatformRole[],
): { ok: true } | { ok: false; response: NextResponse } {
  const required = Array.isArray(allowed) ? allowed : [allowed];
  const allowedSet = new Set(required);
  const has = session.roles.some((r) => allowedSet.has(r));
  if (!has) {
    return {
      ok: false,
      response: jsonError(
        403,
        "FORBIDDEN",
        "You do not have permission to perform this action",
      ),
    };
  }
  return { ok: true };
}

export async function requireSession(
  request: Request,
): Promise<
  { ok: true; context: AuthedContext } | { ok: false; response: NextResponse }
> {
  return authenticateRequest(request);
}

export async function requireSessionWithRoles(
  request: Request,
  roles: PlatformRole | readonly PlatformRole[],
): Promise<
  { ok: true; context: AuthedContext } | { ok: false; response: NextResponse }
> {
  const auth = await authenticateRequest(request);
  if (!auth.ok) {
    return auth;
  }
  const gate = authorizePlatformRoles(auth.context.session, roles);
  if (!gate.ok) {
    return gate;
  }
  return auth;
}
