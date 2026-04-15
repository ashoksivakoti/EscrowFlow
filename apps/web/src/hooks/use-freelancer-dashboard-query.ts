"use client";

import { useQuery } from "@tanstack/react-query";

import type { GetFreelancerDashboardResponse } from "@escrowflow/types";

import {
  ApiRequestError,
  readJsonOrEmpty,
  type ApiErrorJson,
} from "@/lib/api/client-error";

export function useFreelancerDashboardQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["dashboard", "freelancer"],
    enabled,
    queryFn: async (): Promise<GetFreelancerDashboardResponse["dashboard"]> => {
      const res = await fetch("/api/v1/dashboard/freelancer", {
        credentials: "include",
      });
      const raw = await readJsonOrEmpty(res);
      if (!res.ok) {
        throw new ApiRequestError(res.status, raw as ApiErrorJson);
      }
      return (raw as GetFreelancerDashboardResponse).dashboard;
    },
  });
}
