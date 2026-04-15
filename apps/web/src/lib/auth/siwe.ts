import { SiweMessage } from "siwe";

import { getAuthEnv } from "./env";
import { AuthError } from "./errors";

export async function verifySiweMessageAndBinding(
  messageRaw: string,
  signature: string,
): Promise<SiweMessage> {
  const env = getAuthEnv();

  let siwe: SiweMessage;
  try {
    siwe = new SiweMessage(messageRaw);
  } catch {
    throw new AuthError("SIWE_PARSE", "Malformed SIWE message", 400);
  }

  if (!env.AUTH_ALLOWED_CHAIN_IDS.includes(siwe.chainId)) {
    throw new AuthError(
      "CHAIN_NOT_ALLOWED",
      "Chain is not allowed for sign-in",
      400,
    );
  }

  let expectedOrigin: string;
  let actualOrigin: string;
  try {
    expectedOrigin = new URL(env.AUTH_SIWE_URI).origin;
    actualOrigin = new URL(siwe.uri).origin;
  } catch {
    throw new AuthError("URI_INVALID", "Invalid URI in SIWE message", 400);
  }

  if (expectedOrigin !== actualOrigin) {
    throw new AuthError(
      "URI_MISMATCH",
      "SIWE resource URI does not match configured application origin",
      400,
    );
  }

  const result = await siwe.verify(
    {
      signature,
      domain: env.AUTH_SIWE_DOMAIN,
      time: new Date().toISOString(),
    },
    { suppressExceptions: true },
  );

  if (!result.success) {
    throw new AuthError(
      "SIWE_VERIFY_FAILED",
      "Wallet signature could not be verified",
      401,
    );
  }

  return siwe;
}
