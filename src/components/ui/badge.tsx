import { HTMLAttributes, forwardRef } from "react";

const variants = {
  default: "bg-surface-raised text-text-muted border-border",
  pending: "bg-yellow-900/30 text-yellow-400 border-yellow-800",
  paid: "bg-blue-900/30 text-blue-400 border-blue-800",
  submitted: "bg-purple-900/30 text-purple-400 border-purple-800",
  shipped: "bg-green-900/30 text-green-400 border-green-800",
  delivered: "bg-green-900/50 text-green-300 border-green-700",
  draft: "bg-surface-raised text-text-muted border-border",
  approved: "bg-emerald-900/30 text-emerald-400 border-emerald-800",
  ordered: "bg-blue-900/30 text-blue-400 border-blue-800",
  canceled: "bg-red-900/30 text-red-400 border-red-800",
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
