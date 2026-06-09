import { authClient } from "./auth-client";

let ensured: Promise<void> | null = null;

/**
 * Make sure a Better-Auth session cookie exists before a funnel server action
 * runs. On a guest browser this mints an anonymous session (the guest funnel,
 * #26); if a session already exists (real or anon) it's a no-op. The result is
 * memoized so the many funnel handlers that call it share one round-trip; a
 * failed mint clears the cache so a later action can retry.
 *
 * Safe to call regardless of GUEST_FUNNEL_ENABLED: when the flag is off the
 * middleware redirects sessionless visitors away from the funnel before this
 * runs, and a real user's existing session short-circuits the mint.
 */
export function ensureGuestSession(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const { data } = await authClient.getSession();
      if (!data) {
        await authClient.signIn.anonymous();
      }
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}
