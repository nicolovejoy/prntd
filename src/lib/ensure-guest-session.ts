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
 *
 * Only a *clean* no-session read mints. Better-Auth's client returns
 * `{ data, error }`: no session is `data: null, error: null` (200 + null body),
 * while a 5xx/network failure is `data: null` with `error` set. Treating the
 * latter as "no session" would mint a second anonymous user and swap the
 * session cookie out from under whatever the visitor already owns — their
 * designs, cart and orders stay on the old user id.
 */
export function ensureGuestSession(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const { data, error } = await authClient.getSession();
      if (error) {
        // Lookup failed — we don't know whether a session exists. Do nothing
        // and let the next call retry rather than risk swapping the session.
        ensured = null;
        return;
      }
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
