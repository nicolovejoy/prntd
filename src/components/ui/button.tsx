import { ButtonHTMLAttributes, forwardRef } from "react";

const variants = {
  primary:
    "bg-accent text-accent-fg font-medium hover:opacity-90",
  secondary:
    "border border-border text-text-muted hover:border-border-hover hover:text-foreground",
  danger:
    "border border-border text-text-muted hover:border-red-500 hover:text-red-400",
  ghost:
    "text-text-muted hover:text-foreground",
} as const;

const sizes = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
} as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className = "", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`rounded-md transition-colors disabled:opacity-30 ${variants[variant]} ${sizes[size]} ${className}`}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
