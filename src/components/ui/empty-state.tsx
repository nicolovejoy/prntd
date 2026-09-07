import { ReactNode } from "react";

type EmptyStateProps = {
  /** Small mono uppercase marker above the message. Rarely needed today —
   * every current call site is a single line — but the shape is here for
   * when a screen wants to name the section before saying it's empty. */
  label?: string;
  /** The one line of body copy. Kept verbatim from each call site. */
  message: string;
  /** A link or button, wired to whatever the site already pointed at.
   * Retargeting CTAs is a later slice — this only unifies the chrome. */
  action?: ReactNode;
  className?: string;
  /** Overrides the default "empty-state" test id, for a site whose e2e/unit
   * tests already key off a more specific name (e.g. "cart-load-error"). */
  testId?: string;
};

/**
 * One shared empty state for the nine near-identical `text-center py-16`
 * blocks that used to be hand-rolled per page (Studio bench, My Designs,
 * Shop, Orders, Archive, Cart). Same shape everywhere: an optional mono
 * label, one line of muted body copy, one optional action.
 */
export function EmptyState({
  label,
  message,
  action,
  className = "",
  testId = "empty-state",
}: EmptyStateProps) {
  return (
    <div
      data-testid={testId}
      className={`text-center py-16 space-y-4 ${className}`}
    >
      {label && (
        <p className="font-mono uppercase tracking-wide text-[10px] text-text-faint">
          {label}
        </p>
      )}
      <p className="text-text-faint">{message}</p>
      {action}
    </div>
  );
}
