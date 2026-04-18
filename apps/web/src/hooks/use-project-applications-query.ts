"use client";

import { useQuery } from "@tanstack/react-query";

import type { ListProjectApplicationsResponse } from "@escrowflow/types";

import {
  ApiRequestError,
  readJsonOrEmpty,
  type ApiErrorJson,
} from "@/lib/api/client-error";

export function useProjectApplicationsQuery(projectId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["project-applications", projectId],
    enabled: Boolean(projectId) && enabled,
    queryFn: async (): Promise<ListProjectApplicationsResponse> => {
      const res = await fetch(`/api/v1/projects/${projectId}/applications`, {
        credentials: "include",
      });
      const raw = await readJsonOrEmpty(res);
      if (!res.ok) {
        throw new ApiRequestError(res.status, raw as ApiErrorJson);
      }
      return raw as ListProjectApplicationsResponse;
    },
  });
}
