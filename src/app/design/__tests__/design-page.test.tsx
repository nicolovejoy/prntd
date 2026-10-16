/**
 * /design after #188 slice 2c. It never renders a thread. With no `id` a
 * visitor with a session is redirected on the server to the Studio (the idea
 * kept) and a visitor with none gets the thin DesignEntry hop. With an `id`
 * the visitor is redirected: to the conversation's stage or the bench when
 * they have a session, to sign-in (and back) when they have none.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseSeed } from "@/lib/studio-seed";

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  studioHref: vi.fn(),
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
vi.mock("@/lib/studio-entry", () => ({
  conversationStudioHref: (...args: unknown[]) => h.studioHref(...args),
}));
vi.mock("../design-entry", () => ({ DesignEntry: () => null }));

const pageModule = await import("../page");
const DesignPage = pageModule.default;
const { DesignEntry } = await import("../design-entry");

const SESSION = { user: { id: "u1", isAnonymous: false } };
const GUEST = { user: { id: "g1", isAnonymous: true } };

beforeEach(() => {
  vi.clearAllMocks();
  h.getSession.mockResolvedValue(null);
  h.studioHref.mockResolvedValue("/studio");
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
  it("sends a signed-in visitor to the stage conversationStudioHref names", async () => {
    h.getSession.mockResolvedValue(SESSION);
    const stage = "/studio?conversation=design-1&image=img-9";
    h.studioHref.mockResolvedValue(stage);
    expect(await redirectedTo({ id: "design-1" })).toBe(stage);
    expect(h.studioHref).toHaveBeenCalledWith("u1", "design-1");
  });

  it("sends them to the bench when it says so (no result, closed, foreign, missing)", async () => {
    h.getSession.mockResolvedValue(SESSION);
    h.studioHref.mockResolvedValue("/studio");
    expect(await redirectedTo({ id: "design-1" })).toBe("/studio");
  });

  it("looks the conversation up as a guest too", async () => {
    h.getSession.mockResolvedValue(GUEST);
    h.studioHref.mockResolvedValue("/studio?conversation=design-1&image=img-9");
    expect(await redirectedTo({ id: "design-1" })).toBe(
      "/studio?conversation=design-1&image=img-9"
    );
    expect(h.studioHref).toHaveBeenCalledWith("g1", "design-1");
  });

  it("sends a sessionless visitor to sign-in, with the link encoded as next", async () => {
    const url = await redirectedTo({ id: "design-1" });
    expect(url).toBe("/sign-in?next=" + encodeURIComponent("/design?id=design-1"));
    expect(h.studioHref).not.toHaveBeenCalled();
  });

  it("encodes a hostile id inside next, so it cannot add or end a param", async () => {
    const url = await redirectedTo({ id: "a&b=c#d?e/../f" });
    const params = new URL(url, "http://prntd.invalid").searchParams;
    expect([...params.keys()]).toEqual(["next"]);
    expect(params.get("next")).toBe(
      "/design?id=" + encodeURIComponent("a&b=c#d?e/../f")
    );
  });

  it("an id wins over a prompt: the prompt is dropped, no seed is built", async () => {
    h.getSession.mockResolvedValue(SESSION);
    h.studioHref.mockResolvedValue("/studio?conversation=design-1&image=img-9");
    const url = await redirectedTo({ id: "design-1", prompt: "a heron" });
    expect(url).toBe("/studio?conversation=design-1&image=img-9");
    expect(url).not.toContain("prompt");
  });

  it("an id wins over a prompt for a sessionless visitor too", async () => {
    const url = await redirectedTo({ id: "design-1", prompt: "a heron" });
    expect(url).toBe("/sign-in?next=" + encodeURIComponent("/design?id=design-1"));
  });

  it("a failed session read treats the visitor as signed out (sign-in), not a 500", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.getSession.mockRejectedValue(new Error("db down"));
    const url = await redirectedTo({ id: "design-1" });
    expect(url.startsWith("/sign-in?next=")).toBe(true);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("a repeated id is not an id: it falls through to the no-id rules", async () => {
    const element = await DesignPage({
      searchParams: Promise.resolve({ id: ["a", "b"] }),
    });
    expect(element.type).toBe(DesignEntry);
    expect(h.studioHref).not.toHaveBeenCalled();
  });
});

describe("/design route config", () => {
  it("sets no maxDuration: no generation starts from this route any more (R7)", () => {
    expect("maxDuration" in pageModule).toBe(false);
  });
});
