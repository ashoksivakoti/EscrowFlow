import type { UserWithRoles } from "../profile.js";

export type CompleteOnboardingRequest = {
  displayName: string;
  email?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  role: "CLIENT" | "FREELANCER";
};

export type CompleteOnboardingResponse = {
  user: UserWithRoles;
};
