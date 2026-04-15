import { PlatformRole } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type {
  CompleteOnboardingRequest,
  UpdateMeProfileRequest,
  UserWithRoles,
} from "@escrowflow/types";

import { prisma, prismaInteractiveTransactionOptions } from "@/lib/prisma";
import { getUserWithRolesById } from "@/lib/users/queries";
import { toUserWithRoles } from "@/lib/users/serialize";
import { AppError } from "@/server/errors/app-error";

export async function getCurrentUserOrThrow(userId: string): Promise<UserWithRoles> {
  const row = await getUserWithRolesById(userId);
  if (!row) {
    throw AppError.notFound("USER_NOT_FOUND", "User no longer exists");
  }
  return toUserWithRoles(row);
}

export async function updateCurrentUserProfile(
  userId: string,
  payload: UpdateMeProfileRequest,
): Promise<UserWithRoles> {
  const data: Prisma.ProfileUpdateInput = {};
  if (payload.displayName !== undefined) {
    data.displayName = payload.displayName;
  }
  if (payload.bio !== undefined) {
    data.bio = payload.bio;
  }
  if (payload.avatarUrl !== undefined) {
    data.avatarUrl = payload.avatarUrl;
  }
  if (payload.timezone !== undefined) {
    data.timezone = payload.timezone;
  }
  if (payload.email !== undefined) {
    data.email = payload.email;
  }

  try {
    await prisma.profile.update({
      where: { userId },
      data,
    });
  } catch {
    throw AppError.notFound("PROFILE_NOT_FOUND", "Profile could not be updated");
  }
  return getCurrentUserOrThrow(userId);
}

export async function completeOnboarding(
  userId: string,
  payload: CompleteOnboardingRequest,
): Promise<UserWithRoles> {
  const platformRole =
    payload.role === "CLIENT" ? PlatformRole.CLIENT : PlatformRole.FREELANCER;

  await prisma.$transaction(
    async (tx) => {
      const existing = await tx.userPlatformRole.findFirst({
        where: {
          userId,
          role: { in: [PlatformRole.CLIENT, PlatformRole.FREELANCER] },
        },
      });
      if (existing) {
        throw new AppError(
          "ONBOARDING_ALREADY_COMPLETED",
          "Onboarding has already been completed for this account",
          409,
        );
      }

      await tx.profile.update({
        where: { userId },
        data: {
          displayName: payload.displayName,
          email: payload.email ?? null,
          bio: payload.bio ?? null,
          avatarUrl: payload.avatarUrl ?? null,
        },
      });

      await tx.userPlatformRole.create({
        data: {
          userId,
          role: platformRole,
        },
      });
    },
    prismaInteractiveTransactionOptions,
  );

  return getCurrentUserOrThrow(userId);
}
