/**
 * getHeaderState (durable-generation-job task 4): the running-job count
 * joins the header's existing Promise.all rather than adding a second
 * sequential round trip (#144's whole point was collapsing this to one).
 * Every dependency is mocked — the thing under test is composition, not the
 * DB layer underneath isAdminUser/getCartCount/generation-job (each has its
 * own coverage).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => getSession(...args) } },
  isAnonymousUser: (user: { isAnonymous?: boolean | null } | null | undefined) =>
    !!user?.isAnonymous,
}));

const isAdminUser = vi.fn();
vi.mock("@/app/admin/actions", () => ({ isAdminUser: () => isAdminUser() }));

const getCartCount = vi.fn();
vi.mock("@/app/cart/actions", () => ({ getCartCount: () => getCartCount() }));

const sweepStaleJobs = vi.fn();
const countRunningJobsForUser = vi.fn();
vi.mock("@/lib/generation-job", () => ({
  sweepStaleJobs: (...args: unknown[]) => sweepStaleJobs(...args),
  countRunningJobsForUser: (...args: unknown[]) => countRunningJobsForUser(...args),
}));

const { getHeaderState } = await import("@/components/site-header-actions");

beforeEach(() => {
  getSession.mockReset();
  isAdminUser.mockReset().mockResolvedValue(false);
  getCartCount.mockReset().mockResolvedValue(0);
  sweepStaleJobs.mockReset().mockResolvedValue({ swept: 0 });
  countRunningJobsForUser.mockReset().mockResolvedValue(0);
});

describe("getHeaderState — runningJobs", () => {
  it("is 0 for a signed-out visitor, without querying the job table", async () => {
    getSession.mockResolvedValue(null);

    const state = await getHeaderState(false);

    expect(state.runningJobs).toBe(0);
    expect(sweepStaleJobs).not.toHaveBeenCalled();
    expect(countRunningJobsForUser).not.toHaveBeenCalled();
  });

  it("is 0 for an anonymous guest-funnel user, without querying the job table", async () => {
    getSession.mockResolvedValue({ user: { id: "anon-1", isAnonymous: true } });

    const state = await getHeaderState(false);

    expect(state.runningJobs).toBe(0);
    expect(sweepStaleJobs).not.toHaveBeenCalled();
    expect(countRunningJobsForUser).not.toHaveBeenCalled();
  });

  it("sweeps this user's stale jobs, scoped to the user, then counts", async () => {
    getSession.mockResolvedValue({ user: { id: "real-user", isAnonymous: false } });
    countRunningJobsForUser.mockResolvedValue(2);

    const state = await getHeaderState(false);

    expect(state.runningJobs).toBe(2);
    expect(sweepStaleJobs).toHaveBeenCalledWith({ scope: "user", userId: "real-user" });
    expect(countRunningJobsForUser).toHaveBeenCalledWith("real-user");
  });

  it("never uses scope 'all' — that is the cron's alone", async () => {
    getSession.mockResolvedValue({ user: { id: "real-user", isAnonymous: false } });

    await getHeaderState(false);

    for (const call of sweepStaleJobs.mock.calls) {
      expect(call[0].scope).not.toBe("all");
    }
  });
});

/** A promise this test controls the resolution of, plus a resolve() to fire it. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("getHeaderState — one round trip", () => {
  it("invokes admin/cart/jobs before awaiting any of them (Promise.all, not sequential awaits)", async () => {
    // A timing threshold (elapsed < Nms) is a proxy for concurrency, not an
    // assertion of it — it can pass by luck on a fast CI box even against a
    // sequential implementation with small enough delays, and it can flake
    // the other way under load. This test instead makes the mocks controlled
    // (deferred, never resolving until told to) and records the moment each
    // one is CALLED. Promise.all invokes every element of its array
    // synchronously (module microtask hops aside) before awaiting any of
    // them to completion; a sequential `await a(); await b();` rewrite would
    // not call b at all until a's promise resolves. So: if getCartCount and
    // the job-sweep have already been called while isAdminUser's promise is
    // still unresolved, the three ran concurrently — not sequentially.
    const events: string[] = [];
    const admin = deferred<boolean>();
    const cart = deferred<number>();
    const sweep = deferred<{ swept: number }>();
    const count = deferred<number>();

    getSession.mockResolvedValue({ user: { id: "real-user", isAnonymous: false } });
    isAdminUser.mockImplementation(() => {
      events.push("admin:start");
      return admin.promise.then((v) => {
        events.push("admin:end");
        return v;
      });
    });
    getCartCount.mockImplementation(() => {
      events.push("cart:start");
      return cart.promise.then((v) => {
        events.push("cart:end");
        return v;
      });
    });
    sweepStaleJobs.mockImplementation(() => {
      events.push("sweep:start");
      return sweep.promise.then((v) => {
        events.push("sweep:end");
        return v;
      });
    });
    countRunningJobsForUser.mockImplementation(() => {
      events.push("count:start");
      return count.promise.then((v) => {
        events.push("count:end");
        return v;
      });
    });

    const statePromise = getHeaderState(true);

    // Let pending microtasks drain (the running-jobs branch does a real
    // `await auth.api.getSession(...)` before it can call sweepStaleJobs) —
    // without resolving any of the deferred promises above, so nothing can
    // have actually completed yet.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual(
      expect.arrayContaining(["admin:start", "cart:start", "sweep:start"])
    );
    expect(events).not.toContain("admin:end");
    expect(events).not.toContain("cart:end");
    expect(events).not.toContain("sweep:end");

    admin.resolve(true);
    cart.resolve(3);
    sweep.resolve({ swept: 0 });
    await Promise.resolve();
    await Promise.resolve();
    count.resolve(1);

    const state = await statePromise;
    expect(state).toEqual({ isAdmin: true, cartCount: 3, runningJobs: 1 });
  });

  it("skips the cart query entirely when cartOn is false", async () => {
    getSession.mockResolvedValue(null);

    await getHeaderState(false);

    expect(getCartCount).not.toHaveBeenCalled();
  });
});
