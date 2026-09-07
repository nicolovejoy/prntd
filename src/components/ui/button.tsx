import { ButtonHTMLAttributes, forwardRef } from "react";

// Paper (PaperB "quieter"): the primary action is an outlined ink button,
// not a filled one — the one inversion left is the rose "generate" variant
// (see globals.css --accent-rose), reserved for the Studio composer submit
// and the landing hero Generate button, wired in a later slice. One primary
// per screen still applies; "generate" additionally means "the render
// happens now".
const variants = {
  primary:
    "border border-foreground text-foreground bg-transparent hover:bg-surface-well font-medium",
  secondary:
    "border border-border text-text-muted hover:border-foreground hover:text-foreground",
  danger:
    "border border-border text-text-muted hover:border-negative hover:text-negative",
  ghost: "text-text-muted hover:text-foreground",
  generate: "bg-accent-rose text-background hover:opacity-90 font-medium",
} as const;

const sizes = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
} as const;

// Disabled reads as broken with opacity-30 on paper (a faded button looks
// like a rendering glitch, not a state) — a dotted border + muted text is
// legible as "not available" instead. Applied uniformly after the variant
// classes so the `disabled:` modifier's higher specificity wins regardless
// of variant, and pointer-events-none stops hover states from firing on a
// disabled element.
const disabledClasses =
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-transparent disabled:border disabled:border-dotted disabled:border-border disabled:text-text-muted";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className = "", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`rounded-md transition-colors ${variants[variant]} ${sizes[size]} ${disabledClasses} ${className}`}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
