import type { SessionUser } from "@escrowflow/types";

import { getSessionUserFromRequest } from "@/lib/auth/session";
import { AppError } from "@/server/errors/app-error";

export type AuthContext = {
  session: SessionUser;
  userId: string;
};

export async function requireAuthenticated(request: Request): Promise<AuthContext> {
  const session = await getSessionUserFromRequest(request);
  if (!session) {
    throw AppError.unauthenticated();
  }
  return { session, userId: session.id };
}
