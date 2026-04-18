import type { EntityId } from "../primitives";
import type { CursorPageQuery } from "../pagination";
import type { ReviewListItem } from "../views/review";

export type ListReviewsQuery = CursorPageQuery;

export type ListReviewsResponse = {
  items: ReviewListItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type CreateReviewRequest = {
  subjectUserId: EntityId;
  rating: number;
  headline?: string | null;
  body?: string | null;
};

export type CreateReviewResponse = {
  review: ReviewListItem;
};
