import { type LabelHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export function Label({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "inline-flex items-center text-[0.82rem] font-semibold tracking-[0.015em] text-zinc-200",
        className,
      )}
      {...props}
    />
  );
}
