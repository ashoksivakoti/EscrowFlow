import { PlatformRole } from "@prisma/client";
import type { Prisma } from "@prisma/client";

import { prisma, prismaInteractiveTransactionOptions } from "@/lib/prisma";

import { getAuthEnv } from "./env";
import { AuthError } from "./errors";
import { normalizeWalletAddress, shortenWalletDisplay } from "./wallet";
import { type UserForSession, userSessionInclude } from "./user-mapper";

async function ensureAdminPlatformRole(
  tx: Prisma.TransactionClient,
  userId: string,
  walletLower: string,
): Promise<void> {
  const env = getAuthEnv();
  if (!env.AUTH_ADMIN_WALLETS.includes(walletLower)) {
    return;
  }
  await tx.userPlatformRole.upsert({
    where: {
      userId_role: { userId, role: PlatformRole.ADMIN },
    },
    update: {},
    create: { userId, role: PlatformRole.ADMIN },
  });
}

export async function syncUserAfterWalletLogin(
  tx: Prisma.TransactionClient,
  walletAddressFromSiwe: string,
): Promise<{ user: UserForSession; isNewUser: boolean }> {
  const normalized = normalizeWalletAddress(walletAddressFromSiwe);

  const existing = await tx.user.findUnique({
    where: { walletAddress: normalized },
    include: userSessionInclude,
  });

  if (existing) {
    const updated = await tx.user.update({
      where: { id: existing.id },
      data: { lastLoginAt: new Date() },
      include: userSessionInclude,
    });
    await ensureAdminPlatformRole(tx, updated.id, normalized);
    const withRoles = await tx.user.findUniqueOrThrow({
      where: { id: updated.id },
      include: userSessionInclude,
    });
    return { user: withRoles, isNewUser: false };
  }

  const created = await tx.user.create({
    data: {
      walletAddress: normalized,
      lastLoginAt: new Date(),
      profile: {
        create: {
          displayName: shortenWalletDisplay(normalized),
        },
      },
    },
    include: userSessionInclude,
  });

  await ensureAdminPlatformRole(tx, created.id, normalized);

  const reloaded = await tx.user.findUniqueOrThrow({
    where: { id: created.id },
    include: userSessionInclude,
  });

  return { user: reloaded, isNewUser: true };
}

export async function consumeNonceAndLogin(
  nonce: string,
  walletAddressFromSiwe: string,
): Promise<{ user: UserForSession; isNewUser: boolean }> {
  return prisma.$transaction(
    async (tx) => {
      const updated = await tx.siweNonce.updateMany({
        where: {
          nonce,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });

      if (updated.count !== 1) {
        throw new AuthError(
          "NONCE_INVALID",
          "Nonce is invalid, expired, or already used",
          401,
        );
      }

      return syncUserAfterWalletLogin(tx, walletAddressFromSiwe);
    },
    prismaInteractiveTransactionOptions,
  );
}
