import type { IsoDateTimeString } from "./primitives";

export type SortOrder = "asc" | "desc";

/** Keyset / cursor pagination (stable under inserts). */
export type CursorPageQuery = {
  cursor?: string | null;
  /** Default applied server-side if omitted. */
  limit?: number;
};

export type CursorPageMeta = {
  nextCursor: string | null;
  hasMore: boolean;
};

export type CursorPageResponse<T> = CursorPageMeta & {
  items: T[];
};

/** Classic offset pagination for admin or export views. */
export type OffsetPageQuery = {
  page?: number;
  pageSize?: number;
};

export type OffsetPageMeta = {
  total: number;
  page: number;
  pageSize: number;
};

export type OffsetPageResponse<T> = OffsetPageMeta & {
  items: T[];
};

/** Optional sorting hint on list endpoints (field names are resource-specific). */
export type ListSortQuery = {
  sortBy?: string;
  sortOrder?: SortOrder;
};

/** Common filter for time-bounded lists (e.g. notifications, tx logs). */
export type TimeRangeQuery = {
  createdAfter?: IsoDateTimeString;
  createdBefore?: IsoDateTimeString;
};
