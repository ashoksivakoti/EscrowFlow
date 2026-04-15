import { ZodError } from "zod";

import type {
  AuthNonceResponse,
  GetSessionResponse,
  LogoutResponse,
  SessionResponse,
} from "@escrowflow/types";

import { buildSessionSetCookie } from "@/lib/auth/cookies";
import { getAuthEnv } from "@/lib/auth/env";
import { AuthError } from "@/lib/auth/errors";
import { signSessionToken } from "@/lib/auth/jwt-session";
import { createSiweNonce } from "@/lib/auth/nonce";
import { getSessionUserFromRequest, clearSessionCookieHeader } from "@/lib/auth/session";
import { verifySiweMessageAndBinding } from "@/lib/auth/siwe";
import { consumeNonceAndLogin } from "@/lib/auth/user-sync";
import { toSessionUser } from "@/lib/auth/user-mapper";
import { AppError } from "@/server/errors/app-error";

function mapAuthError(error: unknown): never {
  if (error instanceof AppError) {
    throw error;
  }
  if (error instanceof AuthError) {
    throw new AppError(error.code, error.message, error.status);
  }
  if (error instanceof ZodError) {
    throw new AppError(
      "SERVER_MISCONFIGURED",
      "Authentication environment variables are invalid",
      500,
    );
  }
  throw new AppError("INTERNAL_ERROR", "Authentication flow failed", 500);
}

export async function issueSiweNoncePayload(): Promise<AuthNonceResponse> {
  try {
    const env = getAuthEnv();
    const { nonce } = await createSiweNonce();
    return {
      nonce,
      siwe: {
        domain: env.AUTH_SIWE_DOMAIN,
        uri: env.AUTH_SIWE_URI,
        chainId: env.AUTH_ALLOWED_CHAIN_IDS[0]!,
        chainIdsAllowed: [...env.AUTH_ALLOWED_CHAIN_IDS],
        statement: "Sign in to EscrowFlow with your wallet.",
        expirationMinutes: Math.ceil(env.AUTH_NONCE_TTL_SECONDS / 60),
      },
    };
  } catch (error) {
    mapAuthError(error);
  }
}

export async function verifySiweAndBuildSession(
  message: string,
  signature: string,
): Promise<{ payload: SessionResponse; setCookie: string }> {
  try {
    const siwe = await verifySiweMessageAndBinding(message, signature);
    const { user, isNewUser } = await consumeNonceAndLogin(siwe.nonce, siwe.address);
    const env = getAuthEnv();
    const { token, expiresAt } = await signSessionToken(user.id);
    return {
      payload: {
        expiresAt: expiresAt.toISOString(),
        user: toSessionUser(user),
        isNewUser,
      },
      setCookie: buildSessionSetCookie(token, env.AUTH_SESSION_MAX_AGE_SECONDS),
    };
  } catch (error) {
    mapAuthError(error);
  }
}

export async function getSessionResponse(request: Request): Promise<GetSessionResponse> {
  const user = await getSessionUserFromRequest(request);
  return { authenticated: Boolean(user), user };
}

export function buildLogoutResponse(): { payload: LogoutResponse; setCookie: string } {
  return {
    payload: { ok: true },
    setCookie: clearSessionCookieHeader(),
  };
}
