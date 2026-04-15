"use client";

import { useQuery } from "@tanstack/react-query";

import type { GetMeResponse, UserWithRoles } from "@escrowflow/types";

import {
  ApiRequestError,
  readJsonOrEmpty,
  type ApiErrorJson,
} from "@/lib/api/client-error";

export function useMeQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["me"],
    enabled,
    queryFn: async (): Promise<UserWithRoles | null> => {
      const res = await fetch("/api/v1/users/me", { credentials: "include" });
      if (res.status === 401) {
        return null;
      }
      const raw = await readJsonOrEmpty(res);
      if (!res.ok) {
        throw new ApiRequestError(res.status, raw as ApiErrorJson);
      }
      return (raw as GetMeResponse).user;
    },
  });
}
