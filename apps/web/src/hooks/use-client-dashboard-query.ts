"use client";

import { useQuery } from "@tanstack/react-query";

import type { GetClientDashboardResponse } from "@escrowflow/types";

import {
  ApiRequestError,
  readJsonOrEmpty,
  type ApiErrorJson,
} from "@/lib/api/client-error";

export function useClientDashboardQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["dashboard", "client"],
    enabled,
    queryFn: async (): Promise<GetClientDashboardResponse["dashboard"]> => {
      const res = await fetch("/api/v1/dashboard/client", {
        credentials: "include",
      });
      const raw = await readJsonOrEmpty(res);
      if (!res.ok) {
        throw new ApiRequestError(res.status, raw as ApiErrorJson);
      }
      return (raw as GetClientDashboardResponse).dashboard;
    },
  });
}
