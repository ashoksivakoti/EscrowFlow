"use client";

import { useQuery } from "@tanstack/react-query";

import type { ListPublicProjectsResponse } from "@escrowflow/types";

import {
  ApiRequestError,
  readJsonOrEmpty,
  type ApiErrorJson,
} from "@/lib/api/client-error";

export type PublicProjectsQuery = {
  query?: string;
  sortBy?: "updatedAt" | "createdAt";
  sortOrder?: "asc" | "desc";
  limit?: number;
  cursor?: string | null;
};

export function usePublicProjectsQuery(enabled: boolean, query?: PublicProjectsQuery) {
  const params = new URLSearchParams();
  if (query?.query) {
    params.set("query", query.query);
  }
  if (query?.sortBy) {
    params.set("sortBy", query.sortBy);
  }
  if (query?.sortOrder) {
    params.set("sortOrder", query.sortOrder);
  }
  if (typeof query?.limit === "number") {
    params.set("limit", String(query.limit));
  }
  if (query?.cursor) {
    params.set("cursor", query.cursor);
  }
  const queryString = params.toString();

  return useQuery({
    queryKey: ["public-projects", queryString],
    enabled,
    queryFn: async (): Promise<ListPublicProjectsResponse> => {
      const res = await fetch(
        queryString ? `/api/v1/projects/public?${queryString}` : "/api/v1/projects/public",
        { credentials: "include" },
      );
      const raw = await readJsonOrEmpty(res);
      if (!res.ok) {
        throw new ApiRequestError(res.status, raw as ApiErrorJson);
      }
      return raw as ListPublicProjectsResponse;
    },
  });
}
