/**
 * ensureGuestSession only mints an anonymous user on a *clean* no-session read.
 * A failed session lookup (5xx, network) also has `data: null`, and treating it
 * as "no session" swaps the visitor's session cookie for a fresh anonymous
 * user — orphaning their designs, cart and orders on the old user id.
 *
 * A mint that Better-Auth refuses (`{ error }`, notably the 429 of its
 * 3-per-10-s sign-in limit) rejects with a GuestSessionError carrying the
 * status, and clears the memo so a later call can mint (#188 slice 2b review).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();
const signInAnonymous = vi.fn();

vi.mock("../auth-client", () => ({
  authClient: {
    getSession: (...args: unknown[]) => getSession(...args),
    signIn: { anonymous: (...args: unknown[]) => signInAnonymous(...args) },
  },
}));

// Fresh module per test: ensureGuestSession memoizes its result at module scope.
// That reset also re-creates GuestSessionError, so the errors below are matched
// by name and fields, not with instanceof against a stale copy of the class.
type MintError = { name: string; status: number | null; retryAfterSeconds: number | null };
async function loadFresh() {
  vi.resetModules();
  return (await import("../ensure-guest-session")).ensureGuestSession;
}

beforeEach(() => {
  getSession.mockReset();
  signInAnonymous.mockReset();
  signInAnonymous.mockResolvedValue({ data: {}, error: null });
});

describe("ensureGuestSession", () => {
  it("mints an anonymous session when there is genuinely none", async () => {
    getSession.mockResolvedValue({ data: null, error: null });
    const ensureGuestSession = await loadFresh();

    await ensureGuestSession();

    expect(signInAnonymous).toHaveBeenCalledTimes(1);
  });

  it("does not mint when the session lookup fails", async () => {
    getSession.mockResolvedValue({
      data: null,
      error: { status: 500, statusText: "Internal Server Error" },
    });
    const ensureGuestSession = await loadFresh();

    await ensureGuestSession();

    expect(signInAnonymous).not.toHaveBeenCalled();
  });

  it("retries on the next call after a failed lookup", async () => {
    getSession
      .mockResolvedValueOnce({ data: null, error: { status: 500 } })
      .mockResolvedValueOnce({ data: null, error: null });
    const ensureGuestSession = await loadFresh();

    await ensureGuestSession();
    expect(signInAnonymous).not.toHaveBeenCalled();

    await ensureGuestSession();
    expect(signInAnonymous).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when a session already exists", async () => {
    getSession.mockResolvedValue({
      data: { user: { id: "u1" }, session: { id: "s1" } },
      error: null,
    });
    const ensureGuestSession = await loadFresh();

    await ensureGuestSession();

    expect(signInAnonymous).not.toHaveBeenCalled();
  });

  it("memoizes a successful check across callers", async () => {
    getSession.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    const ensureGuestSession = await loadFresh();

    await Promise.all([ensureGuestSession(), ensureGuestSession()]);

    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("clears the memo when getSession rejects outright", async () => {
    getSession
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ data: null, error: null });
    const ensureGuestSession = await loadFresh();

    await expect(ensureGuestSession()).rejects.toThrow("network down");
    expect(signInAnonymous).not.toHaveBeenCalled();

    await ensureGuestSession();
    expect(signInAnonymous).toHaveBeenCalledTimes(1);
  });

  describe("a refused mint", () => {
    const tooMany = {
      data: null,
      error: { status: 429, statusText: "Too Many Requests", message: "Too many requests." },
    };

    it("rejects with a GuestSessionError carrying the status", async () => {
      getSession.mockResolvedValue({ data: null, error: null });
      signInAnonymous.mockResolvedValue(tooMany);
      const ensureGuestSession = await loadFresh();

      const err = await ensureGuestSession().catch((e: unknown) => e);

      expect(err).toBeInstanceOf(Error);
      expect(err).toMatchObject({ name: "GuestSessionError", status: 429, retryAfterSeconds: null });
    });

    it("carries X-Retry-After when the response had one", async () => {
      getSession.mockResolvedValue({ data: null, error: null });
      signInAnonymous.mockImplementation(
        async (arg?: {
          fetchOptions?: { onError?: (ctx: { response: Response }) => void };
        }) => {
          arg?.fetchOptions?.onError?.({
            response: new Response(null, {
              status: 429,
              headers: { "X-Retry-After": "7" },
            }),
          });
          return tooMany;
        }
      );
      const ensureGuestSession = await loadFresh();

      const err = (await ensureGuestSession().catch((e: unknown) => e)) as MintError;

      expect(err.status).toBe(429);
      expect(err.retryAfterSeconds).toBe(7);
    });

    it("keeps the status of a non-429 refusal", async () => {
      getSession.mockResolvedValue({ data: null, error: null });
      signInAnonymous.mockResolvedValue({
        data: null,
        error: { status: 500, statusText: "Internal Server Error" },
      });
      const ensureGuestSession = await loadFresh();

      const err = (await ensureGuestSession().catch((e: unknown) => e)) as MintError;

      expect(err.name).toBe("GuestSessionError");
      expect(err.status).toBe(500);
    });

    it("clears the memo, so the next call mints again", async () => {
      getSession.mockResolvedValue({ data: null, error: null });
      signInAnonymous
        .mockResolvedValueOnce(tooMany)
        .mockResolvedValueOnce({ data: {}, error: null });
      const ensureGuestSession = await loadFresh();

      await expect(ensureGuestSession()).rejects.toMatchObject({ name: "GuestSessionError", status: 429 });
      await expect(ensureGuestSession()).resolves.toBeUndefined();

      expect(signInAnonymous).toHaveBeenCalledTimes(2);
    });

    it("rejects every caller that shared the failed attempt", async () => {
      getSession.mockResolvedValue({ data: null, error: null });
      signInAnonymous.mockResolvedValue(tooMany);
      const ensureGuestSession = await loadFresh();

      const results = await Promise.allSettled([ensureGuestSession(), ensureGuestSession()]);

      expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
      expect(signInAnonymous).toHaveBeenCalledTimes(1);
    });
  });

  it("still resolves without minting when the lookup (not the mint) fails", async () => {
    getSession.mockResolvedValue({ data: null, error: { status: 429 } });
    const ensureGuestSession = await loadFresh();

    await expect(ensureGuestSession()).resolves.toBeUndefined();

    expect(signInAnonymous).not.toHaveBeenCalled();
  });
});
