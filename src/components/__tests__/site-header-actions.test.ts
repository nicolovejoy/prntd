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

describe("getHeaderState — one round trip", () => {
  it("runs admin/cart/jobs concurrently, not as sequential awaits", async () => {
    // Each dependency takes ~40ms. A sequential implementation would take
    // ~120ms+; Promise.all keeps it near the slowest single branch.
    const delay = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 40));
    getSession.mockResolvedValue({ user: { id: "real-user", isAnonymous: false } });
    isAdminUser.mockImplementation(() => delay(true));
    getCartCount.mockImplementation(() => delay(3));
    sweepStaleJobs.mockImplementation(() => delay({ swept: 0 }));
    countRunningJobsForUser.mockImplementation(() => delay(1));

    const start = Date.now();
    const state = await getHeaderState(true);
    const elapsed = Date.now() - start;

    expect(state).toEqual({ isAdmin: true, cartCount: 3, runningJobs: 1 });
    expect(elapsed).toBeLessThan(100);
  });

  it("skips the cart query entirely when cartOn is false", async () => {
    getSession.mockResolvedValue(null);

    await getHeaderState(false);

    expect(getCartCount).not.toHaveBeenCalled();
  });
});
