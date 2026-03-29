import { InputHTMLAttributes, forwardRef } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`px-3 py-2 bg-surface border border-border rounded-md text-foreground placeholder:text-text-faint focus:outline-none focus:border-border-hover ${className}`}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
