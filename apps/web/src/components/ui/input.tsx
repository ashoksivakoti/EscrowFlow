import { forwardRef, type InputHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const inputFieldClassName =
  "w-full min-w-0 rounded-[14px] border border-zinc-800/90 bg-gradient-to-b from-zinc-900 to-zinc-950 px-3.5 py-2.5 text-sm font-medium text-zinc-100 placeholder:text-zinc-500 shadow-[0_1px_0_rgba(255,255,255,0.06)_inset] transition-[border-color,box-shadow,background-color,color] duration-200 hover:border-zinc-700/90 hover:shadow-[0_0_0_1px_rgba(39,39,42,0.3)] focus-visible:border-cyan-300/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/30 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = "text", ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        inputFieldClassName,
        "min-h-12",
        className,
      )}
      {...props}
    />
  );
});
