import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};

type ButtonStyleOptions = Pick<ButtonProps, "variant" | "size" | "className">;

export const buttonBaseClassName =
  "inline-flex max-w-full transform-gpu items-center justify-center gap-2 rounded-[14px] border px-4 text-center text-sm font-semibold tracking-[0.01em] leading-tight touch-manipulation transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none disabled:transform-none active:translate-y-px sm:whitespace-nowrap";

export const buttonSizeClassName = {
  sm: "min-h-11 px-3.5 text-xs",
  md: "min-h-11 px-5 text-sm",
  lg: "min-h-12 px-6 text-base",
} as const;

export const buttonVariantClassName = {
  primary:
    "border-cyan-200/40 bg-gradient-to-b from-cyan-300 via-cyan-400 to-cyan-500 text-zinc-950 shadow-[0_1px_0_rgba(255,255,255,0.48)_inset,0_12px_30px_-16px_rgba(34,211,238,0.9)] hover:from-cyan-200 hover:via-cyan-300 hover:to-cyan-400 hover:shadow-[0_1px_0_rgba(255,255,255,0.55)_inset,0_18px_34px_-16px_rgba(34,211,238,0.95)]",
  secondary:
    "border-zinc-700/90 bg-gradient-to-b from-zinc-900 to-zinc-950 text-zinc-100 shadow-[0_10px_22px_-16px_rgba(0,0,0,0.95)] hover:border-cyan-300/35 hover:text-white hover:shadow-[0_14px_30px_-16px_rgba(34,211,238,0.32)]",
  ghost:
    "border-transparent bg-transparent text-zinc-300 hover:border-cyan-300/20 hover:bg-cyan-400/10 hover:text-cyan-100",
  danger:
    "border-red-200/30 bg-gradient-to-b from-red-400 to-red-600 text-white shadow-[0_1px_0_rgba(255,255,255,0.28)_inset,0_10px_28px_-16px_rgba(220,38,38,0.95)] hover:from-red-300 hover:to-red-500 hover:shadow-[0_12px_30px_-16px_rgba(220,38,38,0.95)]",
} as const;

/** Use on `<Link>` / `<a>` when a native `<button>` is not appropriate. */
export function buttonClassName({
  variant = "primary",
  size = "md",
  className,
}: ButtonStyleOptions = {}): string {
  return cn(
    buttonBaseClassName,
    buttonSizeClassName[size],
    buttonVariantClassName[variant],
    className,
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = "primary", size = "md", disabled, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={buttonClassName({ variant, size, className })}
        {...props}
      />
    );
  },
);
