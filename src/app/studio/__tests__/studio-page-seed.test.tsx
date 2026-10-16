/**
 * The Studio page and the landing seed (#188 slice 2b, tasks 2 and 3). The
 * page parses `?prompt=&lane=&seed=` on the server: a complete seed goes to
 * the client as `initialSeed`, an incomplete one is redirected to a complete
 * address (R3), and a stage address wins over a seed (R4). The sign-in
 * bounce carries the seed so a visitor who has to sign in keeps their idea.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireStudioUser } from "@/lib/require-user";
import { parseSeed } from "@/lib/studio-seed";

const h = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    // next/navigation's redirect throws; mirror that.
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({
  get redirect() {
    return h.redirect;
  },
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/require-user", () => ({
  requireStudioUser: vi.fn(async () => ({
    session: { user: { id: "user-1" } },
    isGuest: false,
  })),
}));
vi.mock("@/lib/studio", () => ({
  getStudioLanesData: vi.fn(async () => []),
  sweepStudioForUser: vi.fn(async () => {}),
}));
vi.mock("../actions", () => ({
  getStudioLanes: vi.fn(async () => []),
  deleteConversations: vi.fn(async () => ({ deleted: [], skipped: [] })),
}));
vi.mock("@/app/design/actions", () => ({
  generateDesign: vi.fn(),
  closeConversation: vi.fn(async () => {}),
  cancelGeneration: vi.fn(async () => true),
}));
vi.mock("@/app/designs/actions", () => ({
  deleteDesign: vi.fn(async () => ({})),
}));

const LANE = "11111111-1111-4111-8111-111111111111";
const SEED = "22222222-2222-4222-8222-222222222222";

const { default: StudioPage, maxDuration } = await import("../page");
const { StudioClient } = await import("../studio-client");

beforeEach(() => {
  vi.clearAllMocks();
});

/** The destination of the redirect the page threw, parsed. */
async function redirectedTo(searchParams: Record<string, string | string[]>) {
  await expect(StudioPage({ searchParams: Promise.resolve(searchParams) })).rejects.toThrow(
    /^NEXT_REDIRECT:/
  );
  const url = h.redirect.mock.calls[0][0];
  return { url, params: new URL(url, "http://prntd.invalid").searchParams };
}

describe("Studio page and the seed", () => {
  it("passes a complete seed to the client as initialSeed", async () => {
    const element = await StudioPage({
      searchParams: Promise.resolve({ prompt: "a heron in tall reeds", lane: LANE, seed: SEED }),
    });
    expect(element.type).toBe(StudioClient);
    const props = element.props as { initialSeed?: unknown; initialFocus?: unknown };
    expect(props.initialSeed).toEqual({
      prompt: "a heron in tall reeds",
      designId: LANE,
      jobId: SEED,
    });
    expect(props.initialFocus).toBeNull();
    expect(h.redirect).not.toHaveBeenCalled();
  });

  it("passes a null initialSeed with no prompt", async () => {
    const element = await StudioPage({ searchParams: Promise.resolve({}) });
    expect((element.props as { initialSeed?: unknown }).initialSeed).toBeNull();
    expect(requireStudioUser).toHaveBeenLastCalledWith("/studio");
  });

  it("keeps the seed on the sign-in bounce", async () => {
    await StudioPage({
      searchParams: Promise.resolve({ prompt: "a heron", lane: LANE, seed: SEED }),
    });
    const gatePath = vi.mocked(requireStudioUser).mock.calls[0][0];
    expect(parseSeed(new URL(gatePath, "http://prntd.invalid").searchParams)).toEqual({
      kind: "complete",
      seed: { prompt: "a heron", designId: LANE, jobId: SEED },
    });
  });

  it("redirects an incomplete seed to a complete one with the same prompt (R3)", async () => {
    const { url, params } = await redirectedTo({ prompt: "  a heron & a reed  " });
    expect(url.startsWith("/studio?")).toBe(true);
    expect(parseSeed(params)).toMatchObject({
      kind: "complete",
      seed: { prompt: "a heron & a reed" },
    });
  });

  it("redirects a seed whose ids are not UUIDs", async () => {
    const { params } = await redirectedTo({ prompt: "a heron", lane: "design-1", seed: "x" });
    const parsed = parseSeed(params);
    expect(parsed.kind).toBe("complete");
    if (parsed.kind === "complete") {
      expect(parsed.seed.designId).not.toBe("design-1");
      expect(parsed.seed.prompt).toBe("a heron");
    }
  });

  it("gates the incomplete seed's sign-in bounce at the address it redirects to", async () => {
    const { url } = await redirectedTo({ prompt: "a heron" });
    expect(requireStudioUser).toHaveBeenLastCalledWith(url);
  });

  it("ignores the seed when a stage address is present, with no redirect (R4)", async () => {
    const element = await StudioPage({
      searchParams: Promise.resolve({
        conversation: "d1",
        image: "img-1",
        prompt: "a heron",
        lane: LANE,
        seed: SEED,
      }),
    });
    const props = element.props as { initialSeed?: unknown; initialFocus?: unknown };
    expect(props.initialSeed).toBeNull();
    expect(props.initialFocus).toEqual({ designId: "d1", imageId: "img-1" });
    expect(h.redirect).not.toHaveBeenCalled();
    expect(requireStudioUser).toHaveBeenLastCalledWith("/studio?conversation=d1&image=img-1");
  });

  it("ignores an incomplete seed beside a stage address too (no redirect)", async () => {
    const element = await StudioPage({
      searchParams: Promise.resolve({ conversation: "d1", image: "img-1", prompt: "a heron" }),
    });
    expect((element.props as { initialSeed?: unknown }).initialSeed).toBeNull();
    expect(h.redirect).not.toHaveBeenCalled();
  });

  it("gets the same 300 s budget as /design (R6)", () => {
    expect(maxDuration).toBe(300);
  });
});
