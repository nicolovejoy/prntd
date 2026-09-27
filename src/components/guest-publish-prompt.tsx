import Link from "next/link";
import { withNext } from "@/lib/safe-next";

export const GUEST_PUBLISH_SIGN_UP_COPY = "Sign up to publish.";
export const GUEST_PUBLISH_SIGN_IN_PROMPT = "Have an account?";
export const GUEST_PUBLISH_SIGN_IN_COPY = "Sign in.";

const LINK_CLASS =
  "inline-flex min-h-11 items-center text-foreground underline underline-offset-[3px] hover:no-underline sm:min-h-0";

/**
 * What a guest sees in place of a Publish button: "Sign up to publish. Have an
 * account? Sign in." Publishing needs a real account (publishImage rejects an
 * anonymous session), and a guest is usually new, so sign-up is the primary
 * link. Sign-in stays for an account holder whose session expired. Signing up
 * or in from this window re-parents the guest's designs (auth.ts's
 * onLinkAccount), and both links carry `next` so the guest returns to the page
 * they came from. Same shape as GuestKeepLine (studio/guest-keep-line.tsx).
 *
 * Plain links, not a Button inside a Link (a button in an anchor is invalid
 * HTML). Each link is a 44px tap target on phones.
 */
export function GuestPublishPrompt({
  next,
  className = "",
}: {
  next: string;
  className?: string;
}) {
  return (
    <p
      data-testid="guest-publish-prompt"
      className={`flex flex-wrap items-center gap-x-1.5 text-sm ${className}`}
    >
      <Link
        href={withNext("/sign-up", next)}
        data-testid="guest-publish-sign-up"
        className={LINK_CLASS}
      >
        {GUEST_PUBLISH_SIGN_UP_COPY}
      </Link>{" "}
      <span className="text-text-muted">{GUEST_PUBLISH_SIGN_IN_PROMPT}</span>{" "}
      <Link
        href={withNext("/sign-in", next)}
        data-testid="guest-publish-sign-in"
        className={LINK_CLASS}
      >
        {GUEST_PUBLISH_SIGN_IN_COPY}
      </Link>
    </p>
  );
}
