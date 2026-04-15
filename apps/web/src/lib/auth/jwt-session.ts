import { randomUUID } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

import { JWT_AUDIENCE, JWT_ISSUER } from "./constants";
import { getAuthEnv } from "./env";

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getAuthEnv().AUTH_SECRET);
}

export async function signSessionToken(
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const env = getAuthEnv();
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + env.AUTH_SESSION_MAX_AGE_SECONDS;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt(nowSec)
    .setExpirationTime(expSec)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setJti(randomUUID())
    .sign(secretKey());
  return { token, expiresAt: new Date(expSec * 1000) };
}

export async function verifySessionTokenToUserId(
  token: string,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ["HS256"],
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
