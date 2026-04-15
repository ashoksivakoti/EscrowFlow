"use client";

import { useQuery } from "@tanstack/react-query";

import type { AdminDisputeDetail, ListAdminDisputesResponse } from "@escrowflow/types";

import {
  ApiRequestError,
  readJsonOrEmpty,
  type ApiErrorJson,
} from "@/lib/api/client-error";

export function useAdminDisputesQuery(
  enabled: boolean,
  filters?: { status?: "open" | "resolved" | "all"; limit?: number },
) {
  const params = new URLSearchParams();
  if (filters?.status) {
    params.set("status", filters.status);
  }
  if (typeof filters?.limit === "number") {
    params.set("limit", String(filters.limit));
  }
  const queryString = params.toString();

  return useQuery({
    queryKey: ["admin-disputes", queryString],
    enabled,
    queryFn: async (): Promise<AdminDisputeDetail[]> => {
      const res = await fetch(
        queryString ? `/api/v1/admin/disputes?${queryString}` : "/api/v1/admin/disputes",
        { credentials: "include" },
      );
      const raw = await readJsonOrEmpty(res);
      if (!res.ok) {
        throw new ApiRequestError(res.status, raw as ApiErrorJson);
      }
      return (raw as ListAdminDisputesResponse).items;
    },
  });
}
