// @vitest-environment node
/**
 * Middleware's cookie gate, pinned for the paths #241 depends on.
 *
 * A first-time visitor has no session cookie at all (/, /shop and /cart mint
 * none). Such a visitor who opens an empty cart and taps "Start a design"
 * must reach a page that can mint the guest session — /design — and not be
 * sent to /sign-in, which is what a sessionless /studio request gets. That is
 * why the empty-cart CTA stays on /design (ruling W1, kept for the empty cart
 * only; see src/app/__tests__/maker-cta-hrefs.test.tsx).
 *
 * Middleware only checks that a cookie exists; whether an anonymous session
 * may use the Studio is requireStudioUser's call (src/lib/require-user.ts).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

const ORIGIN = "https://prntd.test";

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

function redirectTarget(res: Response): string | null {
  const location = res.headers.get("location");
  return location ? new URL(location).pathname : null;
}

let savedFlag: string | undefined;

beforeEach(() => {
  savedFlag = process.env.GUEST_FUNNEL_ENABLED;
});

afterEach(() => {
  if (savedFlag === undefined) delete process.env.GUEST_FUNNEL_ENABLED;
  else process.env.GUEST_FUNNEL_ENABLED = savedFlag;
});

describe("middleware — a visitor with no session (guest funnel on)", () => {
  beforeEach(() => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
  });

  it("passes /design, where the empty-cart CTA sends them", () => {
    expect(redirectTarget(middleware(request("/design")))).toBeNull();
  });

  it("sends /studio and /studio/library to /sign-in", () => {
    expect(redirectTarget(middleware(request("/studio")))).toBe("/sign-in");
    expect(redirectTarget(middleware(request("/studio/library")))).toBe(
      "/sign-in"
    );
  });

  it("sends /orders to /sign-in", () => {
    expect(redirectTarget(middleware(request("/orders")))).toBe("/sign-in");
  });
});

describe("middleware — a visitor with a session cookie", () => {
  it("passes /studio; the page gate decides whether a guest session gets in", () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    const res = middleware(
      request("/studio", "better-auth.session_token=tok.sig")
    );
    expect(redirectTarget(res)).toBeNull();
  });
});

describe("middleware — guest funnel off", () => {
  it("sends a sessionless /design to /sign-in", () => {
    process.env.GUEST_FUNNEL_ENABLED = "false";
    expect(redirectTarget(middleware(request("/design")))).toBe("/sign-in");
  });
});
