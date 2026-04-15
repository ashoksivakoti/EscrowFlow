"use client";

import { useQuery } from "@tanstack/react-query";

import type { ListProjectsResponse } from "@escrowflow/types";

import {
  ApiRequestError,
  readJsonOrEmpty,
  type ApiErrorJson,
} from "@/lib/api/client-error";

export function useProjectsQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["projects"],
    enabled,
    queryFn: async (): Promise<ListProjectsResponse> => {
      const res = await fetch("/api/v1/projects", { credentials: "include" });
      const raw = await readJsonOrEmpty(res);
      if (!res.ok) {
        throw new ApiRequestError(res.status, raw as ApiErrorJson);
      }
      return raw as ListProjectsResponse;
    },
  });
}
