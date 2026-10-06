// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  session: null as unknown,
  sessionThrows: false,
  resolve: vi.fn(async () => "/d/img-1?order=1"),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: h.redirect }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => {
        if (h.sessionThrows) throw new Error("auth down");
        return h.session;
      },
    },
  },
}));
vi.mock("@/lib/preview-redirect", () => ({ resolvePreviewRedirect: h.resolve }));

import PreviewRedirectPage from "../page";

beforeEach(() => {
  h.session = null;
  h.sessionThrows = false;
  h.resolve.mockClear();
  h.redirect.mockClear();
});

describe("/preview redirects (#278 slice 4)", () => {
  it("passes the query and the viewer to the resolver and redirects to its answer", async () => {
    h.session = { user: { id: "u1" } };
    const searchParams = Promise.resolve({ id: "d1", size: "M" });
    await expect(PreviewRedirectPage({ searchParams })).rejects.toThrow(
      "NEXT_REDIRECT /d/img-1?order=1"
    );
    expect(h.resolve).toHaveBeenCalledWith({ id: "d1", size: "M" }, "u1");
  });

  it("treats a failed session read as signed out", async () => {
    h.sessionThrows = true;
    await expect(
      PreviewRedirectPage({ searchParams: Promise.resolve({ id: "d1" }) })
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(h.resolve).toHaveBeenCalledWith({ id: "d1" }, null);
  });
});
