"use client";

import { useQuery } from "@tanstack/react-query";

import type { GetPublicProjectResponse } from "@escrowflow/types";

import {
  ApiRequestError,
  readJsonOrEmpty,
  type ApiErrorJson,
} from "@/lib/api/client-error";

export function usePublicProjectQuery(projectId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["public-project", projectId],
    enabled: Boolean(projectId) && enabled,
    queryFn: async (): Promise<GetPublicProjectResponse> => {
      const res = await fetch(`/api/v1/projects/public/${projectId}`, {
        credentials: "include",
      });
      const raw = await readJsonOrEmpty(res);
      if (!res.ok) {
        throw new ApiRequestError(res.status, raw as ApiErrorJson);
      }
      return raw as GetPublicProjectResponse;
    },
  });
}
