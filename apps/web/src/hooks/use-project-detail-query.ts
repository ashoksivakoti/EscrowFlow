"use client";

import { useQuery } from "@tanstack/react-query";

import type { GetProjectResponse, ProjectDetail } from "@escrowflow/types";

import {
  ApiRequestError,
  readJsonOrEmpty,
  type ApiErrorJson,
} from "@/lib/api/client-error";

export function useProjectDetailQuery(projectId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["project", projectId],
    enabled: enabled && Boolean(projectId),
    queryFn: async (): Promise<ProjectDetail> => {
      if (!projectId) {
        throw new Error("projectId is required");
      }
      const res = await fetch(`/api/v1/projects/${projectId}`, {
        credentials: "include",
      });
      const raw = await readJsonOrEmpty(res);
      if (!res.ok) {
        throw new ApiRequestError(res.status, raw as ApiErrorJson);
      }
      return (raw as GetProjectResponse).project;
    },
  });
}
