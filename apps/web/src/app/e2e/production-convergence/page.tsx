"use client";

import { useState } from "react";

type ConvergenceResponse = {
  action?: "pause" | "unpause";
  txHash?: string;
  apiPaused: boolean | null;
  chainPaused: boolean;
  lastTxHash: string | null;
  lastEventName: string | null;
  lastBlock: string | null;
};

export default function ProductionConvergencePage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<ConvergenceResponse | null>(null);

  async function runFlow(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const token = process.env.NEXT_PUBLIC_E2E_INTERNAL_TOKEN;
      if (!token) {
        throw new Error("NEXT_PUBLIC_E2E_INTERNAL_TOKEN is required");
      }
      const res = await fetch("/api/internal/e2e/pause-convergence", {
        method: "POST",
        headers: {
          "x-e2e-token": token,
        },
      });
      if (!res.ok) {
        throw new Error(`flow failed with status ${res.status}`);
      }
      const json = (await res.json()) as ConvergenceResponse;
      setState(json);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 px-6 py-10">
      <h1 className="text-2xl font-semibold">Production convergence e2e</h1>
      <p className="text-sm text-zinc-400">
        Runs a real pause/unpause transaction, triggers event sync, and reads projected state.
      </p>
      <button
        type="button"
        className="h-10 rounded-md border border-zinc-700 px-4 text-sm"
        onClick={() => void runFlow()}
        disabled={busy}
      >
        {busy ? "Running flow..." : "Run pause convergence flow"}
      </button>
      {error ? <p className="text-sm text-red-400">Error: {error}</p> : null}
      {state ? (
        <section className="rounded-md border border-zinc-800 p-4 text-sm">
          <p data-testid="e2e-action">action: {state.action ?? "unknown"}</p>
          <p data-testid="e2e-tx-hash">txHash: {state.txHash ?? "n/a"}</p>
          <p data-testid="e2e-chain-paused">chainPaused: {String(state.chainPaused)}</p>
          <p data-testid="e2e-api-paused">apiPaused: {String(state.apiPaused)}</p>
          <p data-testid="e2e-event-name">lastEventName: {state.lastEventName ?? "n/a"}</p>
          <p data-testid="e2e-last-tx">lastTxHash: {state.lastTxHash ?? "n/a"}</p>
          <p data-testid="e2e-last-block">lastBlock: {state.lastBlock ?? "n/a"}</p>
        </section>
      ) : null}
    </main>
  );
}
