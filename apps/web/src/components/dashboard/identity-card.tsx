"use client";

import Image from "next/image";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";

export type IdentityRole = "FREELANCER" | "CLIENT" | "ADMIN";

const roleStyles: Record<
  IdentityRole,
  {
    auraClass: string;
    edgeClass: string;
    roleClass: string;
  }
> = {
  FREELANCER: {
    auraClass: "bg-cyan-300/18",
    edgeClass: "via-cyan-100/65",
    roleClass: "text-cyan-200/90",
  },
  CLIENT: {
    auraClass: "bg-cyan-200/12",
    edgeClass: "via-cyan-50/50",
    roleClass: "text-cyan-100/85",
  },
  ADMIN: {
    auraClass: "bg-slate-200/10",
    edgeClass: "via-zinc-100/55",
    roleClass: "text-zinc-200/90",
  },
};

export function IdentityCard({
  companyName,
  userName,
  walletAddress,
  displayWalletAddress,
  balance,
  network,
  role,
  logoSrc,
  defaultBalanceVisible = false,
  maskedBalance = "••••••",
  className,
}: {
  companyName: string;
  userName: string;
  walletAddress: string;
  displayWalletAddress?: string;
  balance: string;
  network: string;
  role: IdentityRole;
  logoSrc: string;
  defaultBalanceVisible?: boolean;
  maskedBalance?: string;
  className?: string;
}) {
  const [isBalanceVisible, setIsBalanceVisible] = useState(defaultBalanceVisible);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const copyResetTimeoutRef = useRef<number | null>(null);
  const style = roleStyles[role];
  const visibleAddress = useMemo(
    () => displayWalletAddress ?? truncateAddress(walletAddress),
    [displayWalletAddress, walletAddress],
  );

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current != null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  function setCopyFeedback(state: "copied" | "error") {
    if (copyResetTimeoutRef.current != null) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }
    setCopyState(state);
    copyResetTimeoutRef.current = window.setTimeout(() => {
      setCopyState("idle");
      copyResetTimeoutRef.current = null;
    }, 1600);
  }

  async function copyWalletAddress() {
    const ok = await copyTextToClipboard(walletAddress);
    if (ok) {
      setCopyFeedback("copied");
    } else {
      setCopyFeedback("error");
    }
  }

  return (
    <div
      className={cn(
        "relative w-full max-w-full overflow-hidden rounded-2xl border border-zinc-400/35 bg-[radial-gradient(150%_90%_at_0%_0%,rgba(255,255,255,0.2),rgba(255,255,255,0)_45%),linear-gradient(130deg,rgba(43,49,60,0.96)_0%,rgba(92,101,116,0.94)_30%,rgba(32,38,47,0.97)_66%,rgba(13,17,24,0.98)_100%)] shadow-[0_28px_60px_-34px_rgba(0,0,0,0.98),0_0_0_1px_rgba(255,255,255,0.04)_inset]",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full blur-3xl",
          style.auraClass,
        )}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40 [background-image:repeating-linear-gradient(108deg,rgba(255,255,255,0.14)_0px,rgba(255,255,255,0.05)_1px,rgba(255,255,255,0)_5px)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70 [background-image:linear-gradient(120deg,rgba(255,255,255,0.18)_0%,rgba(255,255,255,0.03)_36%,rgba(165,243,252,0.08)_100%)]"
      />
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-zinc-100/75 to-transparent",
          style.edgeClass,
        )}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-6 top-[46%] h-px bg-gradient-to-r from-transparent via-white/35 to-transparent blur-[0.4px]"
      />

      <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="relative h-28 w-28 opacity-[0.14] mix-blend-screen sm:h-32 sm:w-32">
          <Image
            src={logoSrc}
            alt=""
            fill
            className="object-contain blur-[0.2px] saturate-75"
          />
        </div>
      </div>

      <div className="relative z-10 flex min-h-[164px] flex-col justify-between px-3 py-3.5 sm:aspect-[1.72/1] sm:min-h-[208px] sm:px-5 sm:py-5">
        <div className="flex items-start justify-between gap-2.5">
          <p className="bg-gradient-to-b from-zinc-100 to-zinc-300 bg-clip-text text-[10px] font-semibold uppercase tracking-[0.18em] text-transparent sm:text-[11px] sm:tracking-[0.2em]">
            {companyName}
          </p>
          <div className="shrink-0 text-right">
            <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Balance</p>
            <div className="mt-1 inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 sm:gap-1.5 sm:px-2 sm:py-1">
              <p className="min-w-[4.8rem] text-right text-[11px] font-medium tabular-nums text-zinc-100 sm:min-w-[5.8rem] sm:text-sm">
                {isBalanceVisible ? balance : maskedBalance}
              </p>
              <button
                type="button"
                aria-label={isBalanceVisible ? "Hide balance" : "Show balance"}
                className="inline-flex h-5 w-5 items-center justify-center rounded text-zinc-400 transition-colors hover:text-cyan-200"
                onClick={() => setIsBalanceVisible((v) => !v)}
              >
                {isBalanceVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2">
          <div className="pointer-events-auto mx-auto flex w-full max-w-[92%] flex-col items-center gap-0.5 sm:max-w-[84%] sm:gap-1">
            <button
              type="button"
              aria-label="Copy full wallet address"
              className="flex w-full items-center justify-center gap-1.5 rounded-xl px-2 py-2 backdrop-blur-[1px] transition-colors hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 sm:gap-2 sm:px-3 sm:py-2.5"
              onClick={() => void copyWalletAddress()}
            >
              <p
                title={walletAddress}
                className="truncate text-center font-mono text-[11px] font-bold tracking-[0.08em] text-zinc-100 sm:text-sm"
              >
                {visibleAddress}
              </p>
              <span
                aria-hidden="true"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-300 transition-colors"
              >
                {copyState === "copied" ? (
                  <Check className="h-3.5 w-3.5 text-cyan-200" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </span>
            </button>
            <p
              className={cn(
                "min-h-[1rem] text-center text-[9px] tracking-[0.12em] transition-colors sm:text-[10px]",
                copyState === "copied"
                  ? "text-cyan-200/85"
                  : copyState === "error"
                    ? "text-rose-200/80"
                    : "text-transparent",
              )}
              aria-live="polite"
            >
              {copyState === "copied"
                ? "Address copied"
                : copyState === "error"
                  ? "Unable to copy"
                  : ""}
            </p>
          </div>
        </div>

        <div className="flex items-end justify-between gap-2 sm:gap-3">
          <div className="min-w-0">
            <p className="truncate text-[0.92rem] font-medium text-zinc-100 sm:text-base">{userName}</p>
            <p className={cn("mt-0.5 text-[10px] uppercase tracking-[0.16em]", style.roleClass)}>
              {role}
            </p>
          </div>
          <div className="min-w-0 text-right">
            <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Network</p>
            <p className="mt-0.5 truncate text-xs font-medium text-zinc-200 sm:text-sm">{network}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function truncateAddress(address: string): string {
  if (!address) {
    return "--";
  }
  if (address.length <= 14) {
    return address;
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Continue to fallback.
    }
  }

  if (typeof document === "undefined") {
    return false;
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}
