/**
 * /design after #188 slice 2b. With no `id` it never renders the thread: a
 * visitor with a session is redirected on the server to the Studio (the idea
 * kept), a visitor with none gets the thin DesignEntry hop. With an `id` it
 * renders the thread client as before (slice 2c retires that).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseSeed } from "@/lib/studio-seed";

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  getThread: vi.fn(),
  redirect: vi.fn((url: string): never => {
    // next/navigation's redirect throws; mirror that.
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({
  get redirect() {
    return h.redirect;
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => h.getSession(...args) } },
  isAnonymousUser: (u: { isAnonymous?: boolean } | null | undefined) => Boolean(u?.isAnonymous),
}));
vi.mock("@/lib/design-thread", () => ({
  getDesignThreadData: (...args: unknown[]) => h.getThread(...args),
}));
vi.mock("../design-client", () => ({ DesignPageClient: () => null }));
vi.mock("../design-entry", () => ({ DesignEntry: () => null }));

const { default: DesignPage, maxDuration } = await import("../page");
const { DesignPageClient } = await import("../design-client");
const { DesignEntry } = await import("../design-entry");

const SESSION = { user: { id: "u1", isAnonymous: false } };
const GUEST = { user: { id: "g1", isAnonymous: true } };

beforeEach(() => {
  vi.clearAllMocks();
  h.getSession.mockResolvedValue(null);
  h.getThread.mockResolvedValue({ thread: true });
});

async function redirectedTo(searchParams: Record<string, string | string[]>) {
  await expect(DesignPage({ searchParams: Promise.resolve(searchParams) })).rejects.toThrow(
    /^NEXT_REDIRECT:/
  );
  return h.redirect.mock.calls[0][0] as string;
}

describe("/design with no id", () => {
  it("redirects a signed-in visitor to the Studio with the idea (R2)", async () => {
    h.getSession.mockResolvedValue(SESSION);
    const url = await redirectedTo({ prompt: "a heron in tall reeds" });
    expect(url.startsWith("/studio?")).toBe(true);
    expect(parseSeed(new URL(url, "http://prntd.invalid").searchParams)).toMatchObject({
      kind: "complete",
      seed: { prompt: "a heron in tall reeds" },
    });
  });

  it("redirects a returning guest too", async () => {
    h.getSession.mockResolvedValue(GUEST);
    const url = await redirectedTo({ prompt: "a heron" });
    expect(url.startsWith("/studio?")).toBe(true);
  });

  it("redirects a visitor with a session and no prompt to the bare Studio", async () => {
    h.getSession.mockResolvedValue(SESSION);
    expect(await redirectedTo({})).toBe("/studio");
  });

  it("treats a blank or repeated prompt as no prompt", async () => {
    h.getSession.mockResolvedValue(SESSION);
    expect(await redirectedTo({ prompt: "   " })).toBe("/studio");
    h.redirect.mockClear();
    expect(await redirectedTo({ prompt: ["a", "b"] })).toBe("/studio");
  });

  it("drops every other param (no id=, no stale lane or seed carried over)", async () => {
    h.getSession.mockResolvedValue(SESSION);
    const url = await redirectedTo({ prompt: "a heron", foo: "bar", conversation: "c", image: "i" });
    const params = new URL(url, "http://prntd.invalid").searchParams;
    expect([...params.keys()].sort()).toEqual(["lane", "prompt", "seed"]);
  });

  it("renders the thin entry, with the prompt, when there is no session", async () => {
    const element = await DesignPage({
      searchParams: Promise.resolve({ prompt: "  a heron  " }),
    });
    expect(element.type).toBe(DesignEntry);
    expect((element.props as { prompt: string | null }).prompt).toBe("a heron");
    expect(h.redirect).not.toHaveBeenCalled();
  });

  it("renders the thin entry with a null prompt when there is none", async () => {
    const element = await DesignPage({ searchParams: Promise.resolve({}) });
    expect(element.type).toBe(DesignEntry);
    expect((element.props as { prompt: string | null }).prompt).toBeNull();
  });

  it("a failed session read degrades to the thin entry, not a 500", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.getSession.mockRejectedValue(new Error("db down"));
    const element = await DesignPage({ searchParams: Promise.resolve({ prompt: "a heron" }) });
    expect(element.type).toBe(DesignEntry);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("treats an empty id as no id", async () => {
    const element = await DesignPage({ searchParams: Promise.resolve({ id: "" }) });
    expect(element.type).toBe(DesignEntry);
  });
});

describe("/design?id=", () => {
  it("still renders the thread client, loading the owner's thread", async () => {
    h.getSession.mockResolvedValue(SESSION);
    const element = await DesignPage({ searchParams: Promise.resolve({ id: "design-1" }) });
    expect(element.type).toBe(DesignPageClient);
    const props = element.props as { initialThreadPromise: Promise<unknown>; canPublish: boolean };
    expect(await props.initialThreadPromise).toEqual({ thread: true });
    expect(h.getThread).toHaveBeenCalledWith("design-1", "u1");
    expect(props.canPublish).toBe(true);
    expect(h.redirect).not.toHaveBeenCalled();
  });

  it("does not redirect a guest with an id, and a guest cannot publish", async () => {
    h.getSession.mockResolvedValue(GUEST);
    const element = await DesignPage({ searchParams: Promise.resolve({ id: "design-1" }) });
    expect(element.type).toBe(DesignPageClient);
    expect((element.props as { canPublish: boolean }).canPublish).toBe(false);
  });

  it("a sessionless id visit still renders the thread client with a null thread", async () => {
    const element = await DesignPage({ searchParams: Promise.resolve({ id: "design-1" }) });
    expect(element.type).toBe(DesignPageClient);
    expect(await (element.props as { initialThreadPromise: Promise<unknown> }).initialThreadPromise).toBeNull();
    expect(h.getThread).not.toHaveBeenCalled();
  });

  it("an id wins over a prompt (the old seed effect does not run for it)", async () => {
    h.getSession.mockResolvedValue(SESSION);
    const element = await DesignPage({
      searchParams: Promise.resolve({ id: "design-1", prompt: "a heron" }),
    });
    expect(element.type).toBe(DesignPageClient);
    expect(h.redirect).not.toHaveBeenCalled();
  });
});

describe("/design route config", () => {
  it("keeps the 300 s budget the thread's generations run under", () => {
    expect(maxDuration).toBe(300);
  });
});
