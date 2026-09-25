import Link from "next/link";

export const GUEST_KEEP_COPY = "Sign up to keep these designs.";

/**
 * The one line a guest sees at the top of both Studio views (#241).
 *
 * A guest's designs belong to the anonymous user behind this browser's
 * cookie. They survive as long as that cookie does; signing up (or in) from
 * this same window re-parents them to the real account (auth.ts's
 * onLinkAccount). The line says the one thing a guest can do about that.
 *
 * Rendered by each page, not by src/app/studio/layout.tsx: whether the viewer
 * is a guest comes from the session, and a layout does not re-render on
 * navigation, so the page — which already reads the session through
 * requireStudioUser — is where that decision belongs.
 *
 * The container matches the views' own gutters and max width so the line
 * sits flush with the tab strip above it; each view keeps its own 24px top
 * gap below.
 */
export function GuestKeepLine() {
  return (
    <div className="px-4 sm:px-6 pt-4 max-w-4xl mx-auto w-full">
      <Link
        href="/sign-up"
        data-testid="guest-keep-line"
        className="inline-flex min-h-11 items-center text-sm text-foreground underline underline-offset-[3px] hover:no-underline sm:min-h-0"
      >
        {GUEST_KEEP_COPY}
      </Link>
    </div>
  );
}
