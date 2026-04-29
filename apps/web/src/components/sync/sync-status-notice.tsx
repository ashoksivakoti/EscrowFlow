"use client";

import { Button } from "@/components/ui/button";
import type { EventSyncStatus } from "@/hooks/use-event-sync-status";
import type { SyncReconciliationStage } from "@/hooks/use-sync-reconciliation";

export function SyncStatusNotice(props: {
  stage: SyncReconciliationStage;
  syncStatus: EventSyncStatus | null;
  syncStatusError?: string | null;
  onRefresh?: () => void;
}) {
  const lagBlocks = props.syncStatus?.lagBlocks ?? null;
  const lagSeconds = props.syncStatus?.lagSeconds ?? null;

  let message: string | null = null;
  if (props.stage === "tx_confirmed" || props.stage === "waiting_sync") {
    message = "Transaction confirmed. Syncing project state...";
  } else if (props.stage === "db_updated") {
    message = "Indexer caught up. Refreshing UI state...";
  } else if (props.stage === "timeout") {
    message = "Sync is taking longer than expected. Refresh from chain.";
  } else if (props.syncStatus?.indexedBehind) {
    message = "Indexer is behind. Showing last synced state.";
  }

  if (!message && !props.syncStatusError) {
    return null;
  }

  return (
    <div className="rounded-xl border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
      <p>{message ?? "Sync status unavailable."}</p>
      {lagBlocks !== null ? (
        <p className="mt-1 text-amber-100/90">
          Lag: {lagBlocks} block{lagBlocks === 1 ? "" : "s"}
          {lagSeconds !== null ? ` (~${lagSeconds}s)` : ""}
        </p>
      ) : null}
      {props.syncStatusError ? <p className="mt-1">{props.syncStatusError}</p> : null}
      {props.onRefresh ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="mt-2 w-full sm:w-auto"
          onClick={props.onRefresh}
        >
          Refresh from chain
        </Button>
      ) : null}
    </div>
  );
}
