import type { PlatformRole, UserWithRoles } from "@escrowflow/types";

import type { UserForSession } from "@/lib/auth/user-mapper";

export function toUserWithRoles(user: UserForSession): UserWithRoles {
  if (!user.profile) {
    throw new Error("User record is missing profile");
  }

  const roles = user.platformRoles.map((r) => r.role as PlatformRole);

  return {
    id: user.id,
    walletAddress: user.walletAddress,
    displayName: user.profile.displayName,
    avatarUrl: user.profile.avatarUrl,
    bio: user.profile.bio,
    timezone: user.profile.timezone,
    email: user.profile.email,
    emailVerifiedAt: user.profile.emailVerifiedAt?.toISOString() ?? null,
    roles,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
