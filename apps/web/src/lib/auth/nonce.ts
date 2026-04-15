import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";

import { getAuthEnv } from "./env";

function generateNonce(): string {
  return randomBytes(16).toString("hex");
}

export async function pruneExpiredSiweNonces(): Promise<void> {
  await prisma.siweNonce.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
}

export async function createSiweNonce(): Promise<{
  nonce: string;
  expiresAt: Date;
}> {
  const env = getAuthEnv();
  await pruneExpiredSiweNonces();

  const nonce = generateNonce();
  const expiresAt = new Date(Date.now() + env.AUTH_NONCE_TTL_SECONDS * 1000);

  await prisma.siweNonce.create({
    data: { nonce, expiresAt },
  });

  return { nonce, expiresAt };
}
