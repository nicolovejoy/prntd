import { InputHTMLAttributes, forwardRef } from "react";

// Paper: 1px ink border at rest (the hairline --border is only 1.73:1 on the
// ground, too faint for a control outline — see docs/design-system.md
// "Tokens"), ink focus ring layered on top rather than a border-color swap.
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = "", ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`px-3 py-2 bg-surface border border-foreground rounded-md text-foreground placeholder:text-text-faint focus:outline-none focus:ring-1 focus:ring-foreground disabled:bg-surface-well disabled:text-text-muted disabled:cursor-not-allowed ${className}`}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
