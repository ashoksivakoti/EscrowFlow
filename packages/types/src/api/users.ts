import type {
  UserWithRoles,
  UpdateProfileRequest,
  UserPublicRef,
} from "../profile";

export type GetMeResponse = {
  user: UserWithRoles;
};

export type UpdateMeProfileRequest = UpdateProfileRequest;

export type UpdateMeProfileResponse = {
  user: UserWithRoles;
};

export type GetUserPublicResponse = {
  user: UserPublicRef;
};
