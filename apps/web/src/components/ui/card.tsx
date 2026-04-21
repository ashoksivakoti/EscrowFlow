import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export const cardSurfaceClassName =
  "relative overflow-hidden rounded-xl border border-zinc-800/90 bg-gradient-to-b from-zinc-900/95 to-zinc-950/95 backdrop-blur-md shadow-[0_16px_36px_-24px_rgba(0,0,0,0.95)] transition-all duration-200 sm:rounded-2xl";

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        cardSurfaceClassName,
        "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-cyan-300/35 before:to-transparent",
        "after:pointer-events-none after:absolute after:inset-0 after:rounded-xl after:ring-1 after:ring-white/[0.03] sm:after:rounded-2xl",
        "hover:border-zinc-700/90 hover:shadow-[0_20px_40px_-24px_rgba(0,0,0,0.95),0_0_0_1px_rgba(34,211,238,0.08)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("mb-6 space-y-2.5 px-4 pt-4 sm:px-6 sm:pt-6", className)}>{children}</div>;
}

export function CardTitle({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <h1
      className={cn(
        "text-xl font-semibold tracking-tight text-zinc-100 sm:text-2xl",
        className,
      )}
    >
      {children}
    </h1>
  );
}

export function CardDescription({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "max-w-prose text-sm leading-relaxed text-zinc-400 sm:text-[0.95rem]",
        className,
      )}
    >
      {children}
    </p>
  );
}
