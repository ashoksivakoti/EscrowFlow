"use client";

import { useQuery } from "@tanstack/react-query";

import type { ListProjectsQuery, ListProjectsResponse } from "@escrowflow/types";

import {
  ApiRequestError,
  readJsonOrEmpty,
  type ApiErrorJson,
} from "@/lib/api/client-error";

export function useProjectsQuery(enabled: boolean, query?: ListProjectsQuery) {
  const params = new URLSearchParams();
  if (query?.query) {
    params.set("query", query.query);
  }
  if (query?.participation) {
    params.set("participation", query.participation);
  }
  const statuses = Array.isArray(query?.status)
    ? query.status
    : query?.status
      ? [query.status]
      : [];
  statuses.forEach((status) => params.append("status", status));
  if (query?.sortBy) {
    params.set("sortBy", query.sortBy);
  }
  if (query?.sortOrder) {
    params.set("sortOrder", query.sortOrder);
  }
  if (typeof query?.limit === "number") {
    params.set("limit", String(query.limit));
  }
  const queryString = params.toString();

  return useQuery({
    queryKey: ["projects", queryString],
    enabled,
    queryFn: async (): Promise<ListProjectsResponse> => {
      const res = await fetch(
        queryString ? `/api/v1/projects?${queryString}` : "/api/v1/projects",
        { credentials: "include" },
      );
      const raw = await readJsonOrEmpty(res);
      if (!res.ok) {
        throw new ApiRequestError(res.status, raw as ApiErrorJson);
      }
      return raw as ListProjectsResponse;
    },
  });
}
