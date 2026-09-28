// @vitest-environment node
/**
 * The proxy's cookie gate, pinned for the paths #241 depends on.
 *
 * A first-time visitor has no session cookie at all (/, /shop and /cart mint
 * none). Such a visitor who opens an empty cart and taps "Start a design"
 * must reach a page that can mint the guest session — /design — and not be
 * sent to /sign-in, which is what a sessionless /studio request gets. That is
 * why the empty-cart CTA stays on /design (ruling W1, kept for the empty cart
 * only; see src/app/__tests__/maker-cta-hrefs.test.tsx).
 *
 * The proxy only checks that a cookie exists; whether an anonymous session
 * may use the Studio is requireStudioUser's call (src/lib/require-user.ts).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { proxy, config } from "@/proxy";

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

describe("proxy — a visitor with no session (guest funnel on)", () => {
  beforeEach(() => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
  });

  it("passes /design, where the empty-cart CTA sends them", () => {
    expect(redirectTarget(proxy(request("/design")))).toBeNull();
  });

  it("sends /studio, /studio/library and /designs to /sign-in", () => {
    expect(redirectTarget(proxy(request("/studio")))).toBe("/sign-in");
    expect(redirectTarget(proxy(request("/studio/library")))).toBe(
      "/sign-in"
    );
    expect(redirectTarget(proxy(request("/designs")))).toBe("/sign-in");
  });

  it("sends /orders to /sign-in", () => {
    expect(redirectTarget(proxy(request("/orders")))).toBe("/sign-in");
  });

  it("carries the intended destination as ?next= for /designs", () => {
    const res = proxy(request("/designs"));
    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    const next = new URL(location as string).searchParams.get("next");
    expect(next).toBe("/designs");
  });

  it("carries the intended destination with its query string for /orders", () => {
    const res = proxy(request("/orders?tab=all"));
    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    const next = new URL(location as string).searchParams.get("next");
    expect(next).toBe("/orders?tab=all");
  });
});

describe("proxy — a visitor with a session cookie", () => {
  it("passes /studio; the page gate decides whether a guest session gets in", () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    const res = proxy(
      request("/studio", "better-auth.session_token=tok.sig")
    );
    expect(redirectTarget(res)).toBeNull();
  });

  it("passes /designs with a cookie too", () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    const res = proxy(
      request("/designs", "better-auth.session_token=tok.sig")
    );
    expect(redirectTarget(res)).toBeNull();
  });

  it("passes /studio with the __Secure- cookie name prod uses on https", () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    const res = proxy(
      request("/studio", "__Secure-better-auth.session_token=tok.sig")
    );
    expect(redirectTarget(res)).toBeNull();
  });
});

describe("proxy — guest funnel off", () => {
  it("sends a sessionless /design to /sign-in", () => {
    process.env.GUEST_FUNNEL_ENABLED = "false";
    expect(redirectTarget(proxy(request("/design")))).toBe("/sign-in");
  });
});

// 16.3.6 exports this helper under the middleware name, although the proxy
// docs call it unstable_doesProxyMatch.
describe("proxy — matcher", () => {
  const matches = (url: string) =>
    unstable_doesMiddlewareMatch({ config, url: `${ORIGIN}${url}` });

  it.each([
    "/designs",
    "/design",
    "/design/x",
    "/preview",
    "/preview/x",
    "/order",
    "/order/confirm",
    "/orders",
    "/orders/x",
    "/admin",
    "/admin/errors",
    "/studio",
    "/studio/library",
  ])("runs on %s", (path) => {
    expect(matches(path)).toBe(true);
  });

  it.each([
    "/api/health",
    "/",
    "/shop",
    "/d/abc",
    "/cart",
    "/sign-in",
    "/sign-up",
  ])("skips %s", (path) => {
    expect(matches(path)).toBe(false);
  });
});
