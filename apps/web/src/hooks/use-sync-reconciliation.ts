"use client";

import { useEffect, useMemo, useState } from "react";

import { useEventSyncStatus } from "@/hooks/use-event-sync-status";

export type SyncReconciliationStage =
  | "idle"
  | "tx_confirmed"
  | "waiting_sync"
  | "db_updated"
  | "ui_refreshed"
  | "timeout";

export function useSyncReconciliation(enabled = true) {
  const syncStatusQuery = useEventSyncStatus(enabled);
  const [stage, setStage] = useState<SyncReconciliationStage>("idle");
  const [targetBlock, setTargetBlock] = useState<bigint | null>(null);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const timeoutMs = 90_000;

  useEffect(() => {
    if (!targetBlock || !startedAtMs) return;
    const lastSynced = syncStatusQuery.data?.lastSyncedBlock
      ? BigInt(syncStatusQuery.data.lastSyncedBlock)
      : null;
    if (lastSynced !== null && lastSynced >= targetBlock) {
      setStage((prev) => (prev === "ui_refreshed" ? prev : "db_updated"));
      return;
    }
    if (Date.now() - startedAtMs > timeoutMs) {
      setStage("timeout");
      return;
    }
    setStage("waiting_sync");
  }, [syncStatusQuery.data?.lastSyncedBlock, startedAtMs, targetBlock]);

  function onTxConfirmed(blockNumber: bigint): void {
    setTargetBlock(blockNumber);
    setStartedAtMs(Date.now());
    setStage("tx_confirmed");
  }

  function markUiRefreshed(): void {
    setStage("ui_refreshed");
  }

  function reset(): void {
    setStage("idle");
    setTargetBlock(null);
    setStartedAtMs(null);
  }

  const isIndexerBehind = Boolean(syncStatusQuery.data?.indexedBehind);

  return useMemo(
    () => ({
      stage,
      targetBlock,
      syncStatus: syncStatusQuery.data ?? null,
      syncStatusError: syncStatusQuery.error instanceof Error ? syncStatusQuery.error.message : null,
      isSyncStatusLoading: syncStatusQuery.isLoading,
      isIndexerBehind,
      onTxConfirmed,
      markUiRefreshed,
      reset,
      refetchSyncStatus: syncStatusQuery.refetch,
    }),
    [isIndexerBehind, stage, syncStatusQuery.data, syncStatusQuery.error, syncStatusQuery.isLoading, syncStatusQuery.refetch, targetBlock],
  );
}
