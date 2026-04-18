import type { UserPublicRef } from "@escrowflow/types";

/** Shape returned by typical Prisma `include: { profile: true }` user selects. */
export type UserPublicRefSource = {
  id: string;
  walletAddress: string;
  profile: { displayName: string; avatarUrl: string | null } | null;
};

export function toUserPublicRef(user: UserPublicRefSource): UserPublicRef {
  return {
    id: user.id,
    walletAddress: user.walletAddress,
    displayName: user.profile?.displayName ?? null,
    avatarUrl: user.profile?.avatarUrl ?? null,
  };
}
