import { forwardRef, type TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/cn";
import { inputFieldClassName } from "@/components/ui/input";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const textareaFieldClassName = inputFieldClassName;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          textareaFieldClassName,
          "min-h-[140px] resize-y leading-relaxed",
          className,
        )}
        {...props}
      />
    );
  },
);
