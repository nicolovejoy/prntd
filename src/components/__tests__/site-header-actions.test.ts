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
const countActiveGenerationsForUser = vi.fn();
vi.mock("@/lib/generation-job", () => ({
  sweepStaleJobs: (...args: unknown[]) => sweepStaleJobs(...args),
  // The DISPLAY count, deliberately not countRunningJobsForUser: a cancelled
  // job still holds its concurrency slot but must not keep the header lit.
  countActiveGenerationsForUser: (...args: unknown[]) =>
    countActiveGenerationsForUser(...args),
}));

/**
 * `after()` is scheduled, not awaited (#210): the sweep must not be on the
 * response path. Same mocking shape as the Studio's after()-sweep tests
 * (src/app/studio/__tests__/studio-archive.integration.test.ts) — queue the
 * callbacks so a test can assert both that nothing ran during the request
 * and what happens when the runtime later drains them.
 */
const afterQueue = vi.hoisted(() => ({ callbacks: [] as (() => unknown)[] }));

vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    afterQueue.callbacks.push(cb);
  },
}));

/** Run every queued `after()` continuation, in registration order. */
async function drainAfter() {
  while (afterQueue.callbacks.length) {
    await afterQueue.callbacks.shift()!();
  }
}

const { getHeaderState } = await import("@/components/site-header-actions");

beforeEach(() => {
  getSession.mockReset();
  isAdminUser.mockReset().mockResolvedValue(false);
  getCartCount.mockReset().mockResolvedValue(0);
  sweepStaleJobs.mockReset().mockResolvedValue({ swept: 0 });
  countActiveGenerationsForUser.mockReset().mockResolvedValue(0);
  afterQueue.callbacks.length = 0;
});

describe("getHeaderState — runningJobs", () => {
  it("is 0 for a signed-out visitor, without querying the job table", async () => {
    getSession.mockResolvedValue(null);

    const state = await getHeaderState(false);

    expect(state.runningJobs).toBe(0);
    expect(sweepStaleJobs).not.toHaveBeenCalled();
    expect(countActiveGenerationsForUser).not.toHaveBeenCalled();
    expect(afterQueue.callbacks).toHaveLength(0);
  });

  it("is 0 for an anonymous guest-funnel user, without querying the job table", async () => {
    getSession.mockResolvedValue({ user: { id: "anon-1", isAnonymous: true } });

    const state = await getHeaderState(false);

    expect(state.runningJobs).toBe(0);
    expect(sweepStaleJobs).not.toHaveBeenCalled();
    expect(countActiveGenerationsForUser).not.toHaveBeenCalled();
    expect(afterQueue.callbacks).toHaveLength(0);
  });

  it("counts without waiting on the sweep, and schedules the sweep with after()", async () => {
    getSession.mockResolvedValue({ user: { id: "real-user", isAnonymous: false } });
    countActiveGenerationsForUser.mockResolvedValue(2);

    const state = await getHeaderState(false);

    // The badge read is inline and unchanged.
    expect(state.runningJobs).toBe(2);
    expect(countActiveGenerationsForUser).toHaveBeenCalledWith("real-user");
    // #210: the write-shaped sweep is off the response path entirely — it has
    // not run by the time the header state is back.
    expect(sweepStaleJobs).not.toHaveBeenCalled();
    expect(afterQueue.callbacks).toHaveLength(1);

    await drainAfter();

    expect(sweepStaleJobs).toHaveBeenCalledWith({ scope: "user", userId: "real-user" });
  });

  it("never uses scope 'all' — that is the cron's alone", async () => {
    getSession.mockResolvedValue({ user: { id: "real-user", isAnonymous: false } });

    await getHeaderState(false);
    await drainAfter();

    expect(sweepStaleJobs).toHaveBeenCalled();
    for (const call of sweepStaleJobs.mock.calls) {
      expect(call[0].scope).not.toBe("all");
    }
  });

  it("a rejecting sweep cannot fail getHeaderState, and cannot reject on drain", async () => {
    getSession.mockResolvedValue({ user: { id: "real-user", isAnonymous: false } });
    countActiveGenerationsForUser.mockResolvedValue(1);
    sweepStaleJobs.mockRejectedValue(new Error("turso is having a day"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    // The request itself is untouched by a sweep that will fail later.
    await expect(getHeaderState(false)).resolves.toEqual({
      isAdmin: false,
      cartCount: 0,
      runningJobs: 1,
    });

    // And when the runtime drains it, nothing escapes: an unhandled rejection
    // here would run on the shared Fluid instance, not in this request.
    await expect(drainAfter()).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("sweepStaleJobs"),
      "turso is having a day"
    );

    logged.mockRestore();
  });

  it("a sweep that never settles cannot hold up the header state", async () => {
    getSession.mockResolvedValue({ user: { id: "real-user", isAnonymous: false } });
    countActiveGenerationsForUser.mockResolvedValue(3);
    // A promise nothing ever resolves. If the sweep were still awaited on the
    // response path, this test would hang instead of failing.
    sweepStaleJobs.mockImplementation(() => new Promise(() => {}));

    const state = await getHeaderState(false);

    expect(state.runningJobs).toBe(3);
  });

  it("schedules the sweep even when the count read throws", async () => {
    getSession.mockResolvedValue({ user: { id: "real-user", isAnonymous: false } });
    countActiveGenerationsForUser.mockRejectedValue(new Error("turso is having a day"));

    await expect(getHeaderState(false)).rejects.toThrow("turso is having a day");

    // The after() is registered before the read, so a thrown read still
    // leaves the sweep scheduled — the invariant the comment above
    // `after(...)` in site-header-actions.ts asserts.
    expect(afterQueue.callbacks).toHaveLength(1);
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
  it("invokes admin/cart/count before awaiting any of them (Promise.all, not sequential awaits)", async () => {
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
    countActiveGenerationsForUser.mockImplementation(() => {
      events.push("count:start");
      return count.promise.then((v) => {
        events.push("count:end");
        return v;
      });
    });

    // #210: the sweep is scheduled via after(), so it is deliberately absent
    // from this choreography — the only three things on the response path are
    // isAdminUser, getCartCount, and the running-jobs count.
    const statePromise = getHeaderState(true);

    // Let pending microtasks drain (the running-jobs branch does a real
    // `await auth.api.getSession(...)` before it can call sweepStaleJobs) —
    // without resolving any of the deferred promises above, so nothing can
    // have actually completed yet.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual(expect.arrayContaining(["admin:start", "cart:start"]));
    expect(events).not.toContain("admin:end");
    expect(events).not.toContain("cart:end");

    admin.resolve(true);
    cart.resolve(3);
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
