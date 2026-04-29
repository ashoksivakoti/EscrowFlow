"use client";

import { useQuery } from "@tanstack/react-query";

export type EventSyncStatus = {
  scope: string;
  chainId: number;
  latestChainBlock: string;
  lastSyncedBlock: string | null;
  lagBlocks: number | null;
  lagSeconds: number | null;
  indexedBehind: boolean;
  lastSuccessAt: string | null;
};

export function useEventSyncStatus(enabled = true) {
  return useQuery({
    queryKey: ["event-sync-status"],
    enabled,
    refetchInterval: 5000,
    queryFn: async (): Promise<EventSyncStatus> => {
      const res = await fetch("/api/v1/sync/status", {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Failed to load event sync status (${res.status})`);
      }
      return (await res.json()) as EventSyncStatus;
    },
  });
}
