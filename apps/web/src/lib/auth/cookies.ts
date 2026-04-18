import { SESSION_COOKIE_NAME } from "./constants";

export function parseCookieHeader(
  header: string | null,
  name: string,
): string | undefined {
  if (!header) {
    return undefined;
  }
  const parts = header.split(";").map((p) => p.trim());
  const prefix = `${name}=`;
  for (const part of parts) {
    if (part.startsWith(prefix)) {
      return decodeURIComponent(part.slice(prefix.length));
    }
  }
  return undefined;
}

export function getSessionTokenFromCookieHeader(
  cookieHeader: string | null,
): string | undefined {
  return parseCookieHeader(cookieHeader, SESSION_COOKIE_NAME);
}

export function buildSessionSetCookie(
  token: string,
  maxAgeSeconds: number,
): string {
  const segments = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Priority=High",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (process.env.NODE_ENV === "production") {
    segments.push("Secure");
  }
  return segments.join("; ");
}

export function buildSessionClearCookie(): string {
  const segments = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Priority=High",
    "Max-Age=0",
  ];
  if (process.env.NODE_ENV === "production") {
    segments.push("Secure");
  }
  return segments.join("; ");
}
