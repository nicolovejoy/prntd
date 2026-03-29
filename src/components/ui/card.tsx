import { HTMLAttributes, forwardRef } from "react";

type CardProps = HTMLAttributes<HTMLDivElement>;

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className = "", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`border border-border rounded-lg bg-surface-raised ${className}`}
        {...props}
      />
    );
  }
);

Card.displayName = "Card";
