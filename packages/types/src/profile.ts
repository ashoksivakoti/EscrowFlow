import type { IsoDateTimeString, WalletAddress } from "./primitives";
import type { PlatformRole } from "./enums";

/** Safe subset for cards and mentions (no private email unless policy allows). */
export type UserPublicRef = {
  id: string;
  walletAddress: WalletAddress;
  displayName: string | null;
  avatarUrl: string | null;
};

export type ProfilePublic = UserPublicRef & {
  bio: string | null;
  timezone: string | null;
};

export type ProfilePrivate = ProfilePublic & {
  email: string | null;
  emailVerifiedAt: IsoDateTimeString | null;
};

export type UpdateProfileRequest = {
  displayName?: string;
  bio?: string | null;
  avatarUrl?: string | null;
  timezone?: string | null;
  email?: string | null;
};

export type UserWithRoles = ProfilePrivate & {
  roles: PlatformRole[];
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
};
