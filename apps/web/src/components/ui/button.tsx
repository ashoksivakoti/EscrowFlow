import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = "primary", size = "md", disabled, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:pointer-events-none disabled:opacity-50",
          size === "sm" && "min-h-9 px-3 text-sm",
          size === "md" && "min-h-11 px-4 text-sm",
          size === "lg" && "min-h-12 px-5 text-base",
          variant === "primary" &&
            "bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 active:bg-indigo-700",
          variant === "secondary" &&
            "border border-zinc-200 bg-white text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800",
          variant === "ghost" &&
            "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800",
          variant === "danger" &&
            "bg-red-600 text-white hover:bg-red-500 active:bg-red-700",
          className,
        )}
        {...props}
      />
    );
  },
);
