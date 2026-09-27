import { safeNextPath, withNext } from "@/lib/safe-next";
import { SignInForm } from "./sign-in-form";

type Search = Promise<{ next?: string }>;

/**
 * Server component so the form's HTML is present on the initial response
 * (a client component reading useSearchParams inside Suspense with no
 * fallback used to send a blank page while it resolved). searchParams is a
 * promise in Next.js 15+/16, so it's awaited here rather than read via a
 * hook.
 *
 * Honor ?next= for post-sign-in redirects. safeNextPath restricts it to
 * same-origin paths to prevent an open redirect. The default is the
 * Studio — under nav model A that is where a signed-in user's work lives.
 * withNext carries the same ?next= onto the "Sign up" link below, so a
 * visitor who followed a next= link here keeps it if they sign up instead.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const { next } = await searchParams;
  return (
    <SignInForm
      redirectTo={safeNextPath(next)}
      signUpHref={withNext("/sign-up", next)}
    />
  );
}
