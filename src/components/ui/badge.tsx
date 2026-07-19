import { HTMLAttributes, forwardRef } from "react";

// Collapsed palette (Clean Label): neutral + the one status pair. Status is
// carried by text color on a neutral pill — terminal-good states read
// positive, canceled reads negative, everything in between stays neutral.
// Variant names stay 1:1 with status strings so call sites pass them through.
const neutral = "bg-surface-raised text-text-muted border-border";
const positive = "bg-surface-raised text-positive border-border";
const negative = "bg-surface-raised text-negative border-border";

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
  archived: "bg-surface-raised text-text-faint border-border",
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
        className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${variants[variant]} ${className}`}
        {...props}
      />
    );
  }
);

Badge.displayName = "Badge";
