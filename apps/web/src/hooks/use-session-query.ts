"use client";

import { useQuery } from "@tanstack/react-query";

import type { GetSessionResponse } from "@escrowflow/types";

export function useSessionQuery() {
  return useQuery({
    queryKey: ["session"],
    queryFn: async (): Promise<GetSessionResponse> => {
      const res = await fetch("/api/v1/auth/session", {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error("Failed to load session");
      }
      return res.json() as Promise<GetSessionResponse>;
    },
  });
}
