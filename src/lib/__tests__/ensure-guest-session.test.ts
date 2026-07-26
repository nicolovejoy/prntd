/**
 * ensureGuestSession only mints an anonymous user on a *clean* no-session read.
 * A failed session lookup (5xx, network) also has `data: null`, and treating it
 * as "no session" swaps the visitor's session cookie for a fresh anonymous
 * user — orphaning their designs, cart and orders on the old user id.
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
});
