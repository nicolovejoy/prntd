import { authClient } from "./auth-client";
import { GuestSessionError, parseRetryAfterSeconds } from "./guest-session-error";

let ensured: Promise<void> | null = null;

/**
 * Make sure a Better-Auth session cookie exists before a funnel server action
 * runs. On a guest browser this mints an anonymous session (the guest funnel,
 * #26); if a session already exists (real or anon) it's a no-op. The result is
 * memoized so the many funnel handlers that call it share one round-trip; a
 * failed mint clears the cache so a later action can retry.
 *
 * Safe to call regardless of GUEST_FUNNEL_ENABLED: when the flag is off the
 * proxy redirects sessionless visitors away from the funnel before this
 * runs, and a real user's existing session short-circuits the mint.
 *
 * Only a *clean* no-session read mints. Better-Auth's client returns
 * `{ data, error }`: no session is `data: null, error: null` (200 + null body),
 * while a 5xx/network failure is `data: null` with `error` set. Treating the
 * latter as "no session" would mint a second anonymous user and swap the
 * session cookie out from under whatever the visitor already owns — their
 * designs, cart and orders stay on the old user id.
 *
 * The mint itself reports failure the same way, and that one must NOT be
 * swallowed: a refused sign-in (notably Better-Auth's rate limit, 3 per 10 s
 * per IP on /sign-in*, which answers 429 with an `X-Retry-After`) leaves the
 * visitor with no cookie, and resolving anyway sends them on to a page that
 * bounces them to /sign-in. So a refused mint rejects with a GuestSessionError
 * (HTTP status, Retry-After when the response had one) and the memo is
 * cleared, which lets a later call mint. One exception: if a session reads
 * back after the refusal (another tab minted in the same moment), it
 * resolves. The lookup-error path above is the opposite on purpose: there a
 * session may already exist, so it resolves without minting, except that a
 * 429 on the lookup (Better-Auth's general limit, 100 per ip|path per 10 s)
 * rejects with a GuestSessionError the same way a refused mint does, and the
 * memo is cleared.
 */
export function ensureGuestSession(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      // Set by the client's onError, which is the only place the response
      // headers are visible; the returned `error` has the body and status.
      let lookupRetryAfter = null as string | null;
      const { data, error } = await authClient.getSession({
        fetchOptions: {
          onError(ctx) {
            lookupRetryAfter = ctx.response?.headers?.get("X-Retry-After") ?? null;
          },
        },
      });
      if (error) {
        // Lookup failed — we don't know whether a session exists, so never
        // mint here and let the next call retry rather than risk swapping the
        // session.
        ensured = null;
        // A rate-limited lookup (429) is the one failure that rejects: the
        // visitor has no cookie yet, and resolving would send them on to a
        // page that bounces a guest to /sign-in. Any other lookup failure
        // resolves, as before.
        if (error.status === 429) {
          throw new GuestSessionError(
            error.message ?? "Session lookup was rate limited",
            429,
            parseRetryAfterSeconds(lookupRetryAfter)
          );
        }
        return;
      }
      if (!data) {
        let retryAfter = null as string | null;
        const minted = await authClient.signIn.anonymous({
          fetchOptions: {
            onError(ctx) {
              retryAfter = ctx.response?.headers?.get("X-Retry-After") ?? null;
            },
          },
        });
        if (minted?.error) {
          // Another tab may have minted in the same moment: its cookie rode
          // on this request, and Better-Auth refuses an anonymous user
          // signing in anonymously again (400). If a session reads back now,
          // the visitor has what they need.
          const after = await authClient.getSession();
          if (!after.error && after.data) return;
          throw new GuestSessionError(
            minted.error.message ?? "Couldn't start a guest session",
            typeof minted.error.status === "number" ? minted.error.status : null,
            parseRetryAfterSeconds(retryAfter)
          );
        }
      }
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}
