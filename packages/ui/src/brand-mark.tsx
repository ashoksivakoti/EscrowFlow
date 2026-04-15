import type { JSX } from "react";

export type BrandMarkProps = {
  className?: string;
};

/**
 * Minimal shared visual anchor for the design system (replace with logo later).
 */
export function BrandMark({ className }: BrandMarkProps): JSX.Element {
  return (
    <span
      className={[
        "inline-flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-900 text-sm font-semibold text-white",
        className ?? "",
      ].join(" ")}
      aria-hidden
    >
      EF
    </span>
  );
}
