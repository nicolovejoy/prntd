/**
 * Studio and My Designs are both in the proxy's ALWAYS_PROTECTED list
 * (src/proxy.ts) — a signed-out visitor tapping either link is bounced
 * straight to /sign-in, so Next prefetching them on every page for every
 * signed-out visitor fetches a page nobody will see. This pins that the bar
 * disables prefetch on those two links, and only those two, while there is
 * no session; a signed-in (or guest-funnel) session keeps Link's own default
 * prefetch.
 *
 * A dedicated file because it needs to mock next/link to observe the
 * `prefetch` prop, which next/link does not forward to the rendered <a> —
 * site-header.test.tsx and site-header-hydration.test.tsx both rely on the
 * real Link and would lose that coverage under a file-wide mock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  session: null as { user: { id: string; isAnonymous?: boolean } } | null,
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: h.session }),
    signOut: vi.fn(async () => {}),
  },
}));

vi.mock("@/components/site-header-actions", () => ({
  getHeaderState: vi.fn(async () => ({
    isAdmin: false,
    cartCount: 0,
    runningJobs: 0,
  })),
}));

vi.mock("@/components/feedback-launcher", () => ({
  FeedbackPanel: () => null,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch,
    children,
    ...rest
  }: {
    href: string;
    prefetch?: boolean;
    children?: ReactNode;
  }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}));

import { SiteHeader } from "../site-header";
import { useHydrated } from "../use-hydrated";

// The header only trusts useSession() once hydrated (React #418) — force
// that immediately so these tests see the post-hydration link set.
vi.mock("../use-hydrated", () => ({ useHydrated: vi.fn(() => true) }));

function prefetchAttr(name: string) {
  return screen.getByRole("link", { name }).getAttribute("data-prefetch");
}

beforeEach(() => {
  h.session = null;
  vi.mocked(useHydrated).mockReturnValue(true);
});

describe("SiteHeader prefetch — no session", () => {
  it("disables prefetch on Studio and My Designs", () => {
    h.session = null;
    render(<SiteHeader cartEnabled={false} />);

    expect(prefetchAttr("Studio")).toBe("false");
    expect(prefetchAttr("My Designs")).toBe("false");
  });

  it("leaves Shop on Link's own default", () => {
    h.session = null;
    render(<SiteHeader cartEnabled={false} />);

    expect(prefetchAttr("Shop")).toBe("undefined");
  });
});

describe("SiteHeader prefetch — a session present", () => {
  it("keeps Link's default prefetch for a signed-in user", () => {
    h.session = { user: { id: "user-1" } };
    render(<SiteHeader cartEnabled={false} />);

    expect(prefetchAttr("Studio")).toBe("undefined");
    expect(prefetchAttr("My Designs")).toBe("undefined");
  });

  it("keeps Link's default prefetch for a guest-funnel session too", () => {
    h.session = { user: { id: "anon-1", isAnonymous: true } };
    render(<SiteHeader cartEnabled={false} />);

    expect(prefetchAttr("Studio")).toBe("undefined");
    expect(prefetchAttr("My Designs")).toBe("undefined");
  });
});
