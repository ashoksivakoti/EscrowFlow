import { cookies } from "next/headers";

import type { SessionUser } from "@escrowflow/types";

import { prisma } from "@/lib/prisma";

import { SESSION_COOKIE_NAME } from "./constants";
import {
  buildSessionClearCookie,
  getSessionTokenFromCookieHeader,
} from "./cookies";
import { verifySessionTokenToUserId } from "./jwt-session";
import { toSessionUser, userSessionInclude } from "./user-mapper";

function bearerFromRequest(request: Request): string | undefined {
  const h = request.headers.get("authorization");
  if (!h?.toLowerCase().startsWith("bearer ")) {
    return undefined;
  }
  const t = h.slice(7).trim();
  return t.length > 0 ? t : undefined;
}

export async function getSessionUserFromRequest(
  request: Request,
): Promise<SessionUser | null> {
  const token =
    bearerFromRequest(request) ??
    getSessionTokenFromCookieHeader(request.headers.get("cookie"));
  if (!token) {
    return null;
  }
  const userId = await verifySessionTokenToUserId(token);
  if (!userId) {
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: userSessionInclude,
  });
  if (!user) {
    return null;
  }
  return toSessionUser(user);
}

/**
 * Server Components / server actions: read the HttpOnly session cookie.
 * Authentication only — enforce authorization (roles, ownership) in each feature.
 */
export async function getServerSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }
  const userId = await verifySessionTokenToUserId(token);
  if (!userId) {
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: userSessionInclude,
  });
  if (!user) {
    return null;
  }
  return toSessionUser(user);
}

export function clearSessionCookieHeader(): string {
  return buildSessionClearCookie();
}
