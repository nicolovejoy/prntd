// @vitest-environment node
/**
 * A visitor with no session at all (no cookie: they came from /, /shop or
 * straight to /cart) gets an empty cart — no throw, no DB read — which is what
 * renders the empty state whose "Start a design" CTA stays on /design (#241
 * fix round; ruling W1 kept for the empty cart only). The CTA href itself is
 * pinned in src/app/__tests__/maker-cta-hrefs.test.tsx, and that a
 * sessionless /design passes middleware while /studio does not in
 * src/__tests__/middleware.test.ts.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => null } },
  isAnonymousUser: () => false,
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Any DB access on the sessionless path is a bug: the read must short-circuit.
vi.mock("@/lib/db", () => ({
  get db() {
    throw new Error("getCart touched the DB without a session");
  },
}));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("@/lib/printful", () => ({ estimateOrderCosts: vi.fn(async () => null) }));

const { getCart, getCartCount } = await import("@/app/cart/actions");

describe("cart reads with no session", () => {
  it("getCart returns an empty cart", async () => {
    await expect(getCart()).resolves.toEqual({
      items: [],
      itemSubtotal: 0,
      shipping: 0,
      total: 0,
    });
  });

  it("getCartCount returns 0", async () => {
    await expect(getCartCount()).resolves.toBe(0);
  });
});
