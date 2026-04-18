import type { EntityId, IsoDateTimeString } from "../primitives";
import type { UserPublicRef } from "../profile";

export type ReviewListItem = {
  id: EntityId;
  projectId: EntityId;
  rating: number;
  headline: string | null;
  body: string | null;
  author: UserPublicRef;
  subject: UserPublicRef;
  createdAt: IsoDateTimeString;
};
