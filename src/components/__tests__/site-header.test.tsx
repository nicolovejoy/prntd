/**
 * Nav model A (docs/ux-design-review-2026-09.md): the bar is Studio · My
 * Designs · Shop · Cart plus an account menu, at every width. Orders, Admin,
 * Feedback, the signed-in email, the build date and Sign out live inside the
 * menu.
 *
 * `useSession`/`getHeaderState` are mocked so the assertions are about the
 * link sets, not the round trips underneath them. Assertions carry label AND
 * destination — a label pointing at the wrong route must fail, not just a
 * wrong word. `pathname` is controllable per test via `h.pathname` so
 * current-section assertions can target a specific route.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent, act } from "@testing-library/react";
import { SiteHeader } from "../site-header";

const h = vi.hoisted(() => ({
  session: null as { user: { id: string; email?: string } } | null,
  headerState: { isAdmin: false, cartCount: 0, runningJobs: 0 },
  pathname: "/",
}));

vi.mock("next/navigation", () => ({ usePathname: () => h.pathname }));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: h.session }),
    signOut: vi.fn(async () => {}),
  },
}));

vi.mock("@/components/site-header-actions", () => ({
  getHeaderState: vi.fn(async () => h.headerState),
}));

vi.mock("@/components/feedback-launcher", () => ({
  FeedbackPanel: () => null,
}));

import { getHeaderState } from "@/components/site-header-actions";

// The header's fixed-string nav links (primaryLinks + accountLinks) — the
// wordmark, the running-jobs badge, and Cart/Sign in/Sign out are excluded
// on purpose: Cart's label carries a variable count suffix ("Cart (3)") so
// there is no single fixed string to filter on, and Cart/Sign in/Sign out
// each already have their own dedicated assertions below that check the
// exact label per auth state, so folding them into this generic filter
// would duplicate coverage rather than add any. Retired entries ("Library",
// "Dashboard") stay in the set on purpose: a regression that re-adds either
// shows up as an extra link, not a silent pass.
const NAV_LABELS = [
  "Studio",
  "My Designs",
  "Shop",
  "Orders",
  "Admin",
  "Library",
  "Dashboard",
];

function linksWithin(container: HTMLElement) {
  return within(container)
    .getAllByRole("link")
    .filter((a) => NAV_LABELS.includes(a.textContent ?? ""))
    .map((a) => [a.textContent, a.getAttribute("href")]);
}

function bar() {
  return screen.getByTestId("header-bar");
}

async function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
  return screen.getByTestId("header-menu");
}

async function settle() {
  // getHeaderState having been *called* proves nothing about whether its
  // resolved isAdmin/cartCount/runningJobs have been committed to a
  // re-render yet — the component's own `.then(setState...)` on that same
  // promise can still be pending. Re-await the exact promise the component
  // is chained off of, inside act(), so React flushes the resulting state
  // update (registered on the promise before ours, so it runs first) before
  // this returns. Only after that is the DOM the fetched header state.
  await waitFor(() => expect(getHeaderState).toHaveBeenCalled());
  const lastCall = vi.mocked(getHeaderState).mock.results.at(-1);
  if (lastCall) {
    await act(async () => {
      await lastCall.value;
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  h.session = null;
  h.headerState = { isAdmin: false, cartCount: 0, runningJobs: 0 };
  h.pathname = "/";
});

describe("SiteHeader bar (signed in)", () => {
  it("is exactly Studio, My Designs, then Shop — no Orders, no Dashboard", async () => {
    h.session = { user: { id: "u1" } };
    render(<SiteHeader cartEnabled={false} />);
    await settle();

    expect(linksWithin(bar())).toEqual([
      ["Studio", "/studio"],
      ["My Designs", "/designs"],
      ["Shop", "/shop"],
    ]);
  });

  it("keeps Cart visible in the bar with its count", async () => {
    h.session = { user: { id: "u1" } };
    h.headerState = { isAdmin: false, cartCount: 3, runningJobs: 0 };
    render(<SiteHeader cartEnabled />);
    await settle();

    const cart = within(bar()).getByRole("link", { name: "Cart (3)" });
    expect(cart.getAttribute("href")).toBe("/cart");
  });
});

describe("SiteHeader account menu", () => {
  it("holds Orders and, for an admin, Admin — no primary verb inside", async () => {
    h.session = { user: { id: "u1", email: "a@b.test" } };
    h.headerState = { isAdmin: true, cartCount: 0, runningJobs: 0 };
    render(<SiteHeader cartEnabled={false} />);
    await settle();

    const menu = await openMenu();
    expect(linksWithin(menu)).toEqual([
      ["Orders", "/orders"],
      ["Admin", "/admin"],
    ]);
    expect(within(menu).getByText("a@b.test")).toBeTruthy();
    expect(within(menu).getByRole("button", { name: "Feedback" })).toBeTruthy();
    expect(within(menu).getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("omits Admin for a non-admin", async () => {
    h.session = { user: { id: "u1" } };
    render(<SiteHeader cartEnabled={false} />);
    await settle();

    const menu = await openMenu();
    expect(linksWithin(menu).map(([label]) => label)).not.toContain("Admin");
  });

  it("never shows Dashboard or Library anywhere", async () => {
    h.session = { user: { id: "u1" } };
    h.headerState = { isAdmin: true, cartCount: 0, runningJobs: 0 };
    render(<SiteHeader cartEnabled />);
    await settle();
    await openMenu();

    expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Library" })).toBeNull();
    expect(screen.queryByText("New Design")).toBeNull();
  });
});

describe("SiteHeader signed out", () => {
  it("shows Studio, My Designs, Shop and Sign in in the bar, and no Orders anywhere", async () => {
    render(<SiteHeader cartEnabled={false} />);
    await settle();

    expect(linksWithin(bar())).toEqual([
      ["Studio", "/studio"],
      ["My Designs", "/designs"],
      ["Shop", "/shop"],
    ]);
    expect(within(bar()).getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();

    const menu = await openMenu();
    expect(linksWithin(menu).map(([label]) => label)).not.toContain("Orders");
    expect(within(menu).getByRole("button", { name: "Feedback" })).toBeTruthy();
  });
});

describe("running-jobs badge", () => {
  it("links to /studio", async () => {
    h.session = { user: { id: "u1" } };
    h.headerState = { isAdmin: false, cartCount: 0, runningJobs: 2 };
    render(<SiteHeader cartEnabled={false} />);

    const badge = await screen.findByTestId("running-jobs-badge");
    expect(badge.getAttribute("href")).toBe("/studio");
  });
});

describe("SiteHeader phone tap targets (44px rule)", () => {
  // jsdom does not run a layout engine or resolve Tailwind's CSS, so this
  // cannot verify the actual rendered pixel size of either control — only
  // that the utility classes that produce a 44px box (min-h-11 / min-w-11)
  // are present on the elements the project's 44px rule binds on phones.
  // That is a real, meaningfully-failable regression guard (it fails if a
  // future edit drops the classes), but it is not proof of the rendered
  // size; there is no stronger assertion available under this harness.
  it("gives the bar's Cart link a 44px-tall class on phones", async () => {
    h.session = { user: { id: "u1" } };
    h.headerState = { isAdmin: false, cartCount: 1, runningJobs: 0 };
    render(<SiteHeader cartEnabled />);
    await settle();

    const cart = within(bar()).getByRole("link", { name: "Cart (1)" });
    expect(cart.className).toContain("min-h-11");
  });

  it("gives the account-menu trigger a 44px-square class on phones", async () => {
    render(<SiteHeader cartEnabled={false} />);
    await settle();

    const trigger = screen.getByRole("button", { name: "Account menu" });
    expect(trigger.className).toContain("min-h-11");
    expect(trigger.className).toContain("min-w-11");
  });
});

describe("SiteHeader responsive split (bar vs menu)", () => {
  // Sign in still renders twice: a bar copy meant for sm: and up (hidden
  // sm:inline) and a menu copy meant for phones only (sm:hidden). Swap those
  // two classes on a future edit and a phone user sees it twice, or not at
  // all. jsdom resolves no CSS, so this only proves the right class token
  // sits on the right copy, not that it renders the right layout at either
  // width — same honesty as the 44px tap-target tests above.
  //
  // Token equality (not substring) on purpose: "sm:hidden" contains the
  // substring "hidden", so a substring check on "hidden" would still pass
  // even after a swap and silently fail to catch it.
  function classTokens(el: Element) {
    return el.className.split(/\s+/).filter(Boolean);
  }

  it("gives the bar's Sign-in copy hidden sm:inline, not sm:hidden", async () => {
    render(<SiteHeader cartEnabled={false} />);
    await settle();

    const tokens = classTokens(within(bar()).getByRole("link", { name: "Sign in" }));
    expect(tokens).toContain("hidden");
    expect(tokens).toContain("sm:inline");
    expect(tokens).not.toContain("sm:hidden");
  });

  it("gives the menu's Sign-in copy sm:hidden, not hidden sm:inline", async () => {
    render(<SiteHeader cartEnabled={false} />);
    await settle();

    const menu = await openMenu();
    const tokens = classTokens(within(menu).getByRole("link", { name: "Sign in" }));
    expect(tokens).toContain("sm:hidden");
    expect(tokens).not.toContain("hidden");
    expect(tokens).not.toContain("sm:inline");
  });

  it("keeps Studio, My Designs and Shop in the bar at every width (no hidden class)", async () => {
    render(<SiteHeader cartEnabled={false} />);
    await settle();

    for (const label of ["Studio", "My Designs", "Shop"]) {
      const tokens = classTokens(within(bar()).getByRole("link", { name: label }));
      expect(tokens).not.toContain("hidden");
      expect(tokens).not.toContain("sm:hidden");
    }
  });
});

describe("SiteHeader current-section styling", () => {
  it("marks exactly one bar link aria-current for /designs", async () => {
    h.pathname = "/designs";
    render(<SiteHeader cartEnabled />);
    await settle();

    const current = within(bar())
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["My Designs"]);
  });

  it("marks exactly one bar link aria-current for each of /studio, /shop, /cart", async () => {
    for (const [path, label] of [
      ["/studio", "Studio"],
      ["/shop", "Shop"],
      ["/cart", "Cart"],
    ] as const) {
      h.pathname = path;
      const { unmount } = render(<SiteHeader cartEnabled />);
      await settle();

      const current = within(bar())
        .getAllByRole("link")
        .filter((a) => a.getAttribute("aria-current") === "page");
      expect(current.map((a) => a.textContent)).toEqual([label]);
      unmount();
    }
  });

  it("marks no bar link current on /design or /", async () => {
    for (const path of ["/design", "/"]) {
      h.pathname = path;
      const { unmount } = render(<SiteHeader cartEnabled />);
      await settle();

      const current = within(bar())
        .getAllByRole("link")
        .filter((a) => a.getAttribute("aria-current") === "page");
      expect(current).toEqual([]);
      unmount();
    }
  });
});

describe("SiteHeader running-jobs phone dot", () => {
  it("shows the dot and sr-only text on the Studio link when jobs are running", async () => {
    h.session = { user: { id: "u1" } };
    h.headerState = { isAdmin: false, cartCount: 0, runningJobs: 2 };
    render(<SiteHeader cartEnabled={false} />);
    await settle();

    expect(screen.getByTestId("running-jobs-dot")).toBeTruthy();
    const studioLink = within(bar()).getByRole("link", { name: /Studio/ });
    expect(within(studioLink).getByText(/2 generating/)).toBeTruthy();
  });

  it("omits the dot when no jobs are running", async () => {
    render(<SiteHeader cartEnabled={false} />);
    await settle();

    expect(screen.queryByTestId("running-jobs-dot")).toBeNull();
  });

  it("keeps the full badge's href even though it is hidden on phones", async () => {
    h.session = { user: { id: "u1" } };
    h.headerState = { isAdmin: false, cartCount: 0, runningJobs: 2 };
    render(<SiteHeader cartEnabled={false} />);
    await settle();

    const badge = await screen.findByTestId("running-jobs-badge");
    expect(badge.getAttribute("href")).toBe("/studio");
    expect(badge.className.split(/\s+/)).toContain("hidden");
    expect(badge.className.split(/\s+/)).toContain("sm:inline-flex");
  });
});
