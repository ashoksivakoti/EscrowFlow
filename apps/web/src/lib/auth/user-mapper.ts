import type {
  PlatformRole,
  ProfilePublic,
  SessionUser,
} from "@escrowflow/types";
import type { Prisma } from "@prisma/client";

export const userSessionInclude = {
  profile: true,
  platformRoles: true,
} satisfies Prisma.UserInclude;

export type UserForSession = Prisma.UserGetPayload<{
  include: typeof userSessionInclude;
}>;

export function toSessionUser(user: UserForSession): SessionUser {
  const roles = user.platformRoles.map((r) => r.role as PlatformRole);
  const profile: ProfilePublic | null = user.profile
    ? {
        id: user.id,
        walletAddress: user.walletAddress,
        displayName: user.profile.displayName,
        avatarUrl: user.profile.avatarUrl,
        bio: user.profile.bio,
        timezone: user.profile.timezone,
      }
    : null;

  return {
    id: user.id,
    walletAddress: user.walletAddress,
    roles,
    profile,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}
