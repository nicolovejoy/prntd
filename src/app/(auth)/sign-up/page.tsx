import { safeNextPath, withNext } from "@/lib/safe-next";
import { SignUpForm } from "./sign-up-form";

type Search = Promise<{ next?: string }>;

/**
 * Server component so the form's HTML is present on the initial response
 * (a client component reading useSearchParams inside Suspense with no
 * fallback used to send a blank page while it resolved). searchParams is a
 * promise in Next.js 15+/16, so it's awaited here rather than read via a
 * hook.
 *
 * Honor ?next= for post-sign-up redirects, matching sign-in — see the
 * matching comment there. safeNextPath restricts it to same-origin paths to
 * prevent an open redirect; withNext carries the same ?next= onto the
 * "Sign in" link below.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const { next } = await searchParams;
  return (
    <SignUpForm
      redirectTo={safeNextPath(next)}
      signInHref={withNext("/sign-in", next)}
    />
  );
}
