"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useQueryClient } from "@tanstack/react-query";
import { SiweMessage } from "siwe";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useAccount, useChainId, useSignMessage, useSwitchChain } from "wagmi";

import type { AuthNonceResponse, SessionResponse } from "@escrowflow/types";

import { needsOnboarding } from "@/lib/auth/client-guards";
import {
  ApiRequestError,
  readJsonOrEmpty,
  type ApiErrorJson,
} from "@/lib/api/client-error";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";

export function SignInPanel() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { address, isConnected, status } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync, isPending: isSigning } = useSignMessage();

  const [phase, setPhase] = useState<
    "idle" | "nonce" | "signing" | "verifying" | "success"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  const walletLoading = status === "connecting" || status === "reconnecting";

  const signIn = useCallback(async () => {
    setError(null);
    if (!address) {
      setError("Connect your wallet first.");
      return;
    }

    setPhase("nonce");
    try {
      const nonceRes = await fetch("/api/v1/auth/siwe/nonce", {
        credentials: "include",
      });
      const nonceRaw = await readJsonOrEmpty(nonceRes);
      if (!nonceRes.ok) {
        throw new ApiRequestError(nonceRes.status, nonceRaw as ApiErrorJson);
      }
      const nonceJson = nonceRaw as AuthNonceResponse;

      const allowed = nonceJson.siwe.chainIdsAllowed;
      let effectiveChainId = chainId;
      if (!allowed.includes(chainId)) {
        if (!switchChainAsync) {
          throw new Error(
            `Switch your wallet to one of these chain IDs: ${allowed.join(", ")}`,
          );
        }
        await switchChainAsync({ chainId: allowed[0]! });
        effectiveChainId = allowed[0]!;
      }

      const expiresMs =
        (nonceJson.siwe.expirationMinutes ?? 5) * 60 * 1000;
      const siweMessage = new SiweMessage({
        domain: nonceJson.siwe.domain,
        address,
        statement:
          nonceJson.siwe.statement ??
          "Sign in to EscrowFlow with your wallet.",
        uri: nonceJson.siwe.uri,
        version: "1",
        chainId: effectiveChainId,
        nonce: nonceJson.nonce,
        expirationTime: new Date(Date.now() + expiresMs).toISOString(),
      });

      const message = siweMessage.prepareMessage();
      setPhase("signing");
      const signature = await signMessageAsync({ message });
      setPhase("verifying");

      const verifyRes = await fetch("/api/v1/auth/siwe/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      const verifyRaw = await readJsonOrEmpty(verifyRes);
      if (!verifyRes.ok) {
        throw new ApiRequestError(verifyRes.status, verifyRaw as ApiErrorJson);
      }
      const session = verifyRaw as SessionResponse;

      await queryClient.invalidateQueries({ queryKey: ["session"] });
      await queryClient.invalidateQueries({ queryKey: ["me"] });

      setPhase("success");

      const next =
        session.isNewUser || needsOnboarding(session.user)
          ? "/onboarding"
          : "/dashboard";
      router.replace(next);
    } catch (e) {
      setPhase("idle");
      if (e instanceof ApiRequestError) {
        setError(e.message);
        return;
      }
      if (e instanceof Error) {
        setError(e.message);
        return;
      }
      setError("Something went wrong. Please try again in a moment.");
    }
  }, [
    address,
    chainId,
    queryClient,
    router,
    signMessageAsync,
    switchChainAsync,
  ]);

  const busy =
    walletLoading ||
    phase === "nonce" ||
    phase === "signing" ||
    phase === "verifying" ||
    isSigning;

  const phaseLabel =
    phase === "nonce" || phase === "verifying"
      ? "Verifying secure challenge"
      : phase === "signing" || isSigning
        ? "Awaiting wallet signature"
        : phase === "success"
          ? "Signed in"
          : "Ready";

  return (
    <div className="flex w-full max-w-full flex-col gap-5 px-4 pb-5 sm:px-6 sm:pb-6">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800/90 bg-zinc-900/55 px-3 py-2.5">
        <span className="text-xs font-medium uppercase tracking-[0.14em] text-cyan-200/90">
          Wallet auth
        </span>
        <span className="max-w-full truncate rounded-full border border-zinc-700/90 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-300">
          {phaseLabel}
        </span>
      </div>

      <div className="flex min-h-12 w-full max-w-full flex-col gap-3 rounded-xl border border-zinc-800/90 bg-zinc-950/75 p-3 transition-colors hover:border-zinc-700 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm font-medium text-zinc-300">Wallet</span>
        <div className="w-full min-w-0 sm:w-auto sm:max-w-[290px] [&_button]:min-h-12 [&_button]:w-full [&_button]:max-w-full [&_button]:rounded-xl [&_button]:border-zinc-700/80 [&_button]:bg-zinc-900/90 [&_button]:text-zinc-100 [&_button]:hover:border-cyan-300/40 [&_button]:hover:bg-zinc-900">
          <ConnectButton chainStatus="icon" showBalance={false} />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Button
          type="button"
          size="lg"
          className="w-full"
          disabled={!isConnected || busy || phase === "success"}
          onClick={() => void signIn()}
        >
          {phase === "nonce" || phase === "verifying"
            ? "Verifying..."
            : phase === "signing" || isSigning
              ? "Awaiting wallet signature..."
              : phase === "success"
                ? "Redirecting..."
                : "Sign in with Ethereum"}
        </Button>
        <p className="px-1 text-center text-xs leading-relaxed text-zinc-400">
          You will sign a one-time message. No on-chain transaction is created.
        </p>
      </div>

      <FieldError message={error ?? undefined} className="text-center" />
    </div>
  );
}
