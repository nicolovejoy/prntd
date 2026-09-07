import { HTMLAttributes, forwardRef } from "react";

// Collapsed palette (Clean Label): neutral + the one status pair. Paper drops
// the pill entirely — a Badge is a mono uppercase label, not a colored chip.
// Status is carried by text color alone: terminal-good states read positive,
// canceled reads negative, everything in between stays neutral. Variant
// names stay 1:1 with status strings so call sites pass them through.
const neutral = "text-text-muted";
const positive = "text-positive";
const negative = "text-negative";

const variants = {
  default: neutral,
  pending: neutral,
  paid: neutral,
  submitted: neutral,
  shipped: positive,
  delivered: positive,
  draft: neutral,
  approved: neutral,
  ordered: neutral,
  archived: "text-text-faint",
  canceled: negative,
} as const;

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: keyof typeof variants;
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ variant = "default", className = "", ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={`font-mono uppercase tracking-wide text-[10px] ${variants[variant]} ${className}`}
        {...props}
      />
    );
  }
);

Badge.displayName = "Badge";
