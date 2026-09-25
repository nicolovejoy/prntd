import Link from "next/link";

export const GUEST_SIGN_UP_COPY = "Sign up to keep these designs.";
export const GUEST_SIGN_IN_PROMPT = "Have an account?";
export const GUEST_SIGN_IN_COPY = "Sign in.";

const LINK_CLASS =
  "inline-flex min-h-11 items-center text-foreground underline underline-offset-[3px] hover:no-underline sm:min-h-0";

/**
 * The one line a guest sees at the top of both Studio views (#241):
 * "Sign up to keep these designs. Have an account? Sign in."
 *
 * A guest's designs belong to the anonymous user behind this browser's
 * cookie. They survive as long as that cookie does; signing up OR signing in
 * from this same window re-parents them to the real account (auth.ts's
 * onLinkAccount). Both links are here because a guest is not always new: an
 * account holder whose session expired and who started again from the
 * homepage composer is a guest too, sign-up would refuse their email, and on
 * a phone the header's own "Sign in" is inside the menu. Both sign-up and
 * sign-in land on /studio afterwards.
 *
 * Rendered only when there is something to keep — the callers skip it on an
 * empty bench or library, where it would sit beside "No designs yet." — and
 * by the views themselves rather than src/app/studio/layout.tsx: whether the
 * viewer is a guest comes from the session, and a layout does not re-render
 * on navigation.
 *
 * The container matches the views' own gutters and max width so the line
 * sits flush with the tab strip above it; each view keeps its own 24px top
 * gap below. Each link is a 44px tap target on phones; the flex row wraps on
 * narrow screens, and the {" "} nodes keep the sentence readable as text.
 */
export function GuestKeepLine() {
  return (
    <div className="px-4 sm:px-6 pt-4 max-w-4xl mx-auto w-full">
      <p
        data-testid="guest-keep-line"
        className="flex flex-wrap items-center gap-x-1.5 text-sm"
      >
        <Link href="/sign-up" data-testid="guest-sign-up" className={LINK_CLASS}>
          {GUEST_SIGN_UP_COPY}
        </Link>{" "}
        <span className="text-text-muted">{GUEST_SIGN_IN_PROMPT}</span>{" "}
        <Link href="/sign-in" data-testid="guest-sign-in" className={LINK_CLASS}>
          {GUEST_SIGN_IN_COPY}
        </Link>
      </p>
    </div>
  );
}
