/**
 * Nav model A (docs/ux-design-review-2026-09.md): the bar is Studio · Shop ·
 * Cart plus an account menu. Orders, Admin, Feedback, the signed-in email,
 * the build date and Sign out live inside the menu; My Designs is gone from
 * the header entirely (it is the Studio's Library tab).
 *
 * `useSession`/`getHeaderState` are mocked so the assertions are about the
 * link sets, not the round trips underneath them. Assertions carry label AND
 * destination — a label pointing at the wrong route must fail, not just a
 * wrong word.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent, act } from "@testing-library/react";
import { SiteHeader } from "../site-header";

const h = vi.hoisted(() => ({
  session: null as { user: { id: string; email?: string } } | null,
  headerState: { isAdmin: false, cartCount: 0, runningJobs: 0 },
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

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

// Every nav word the header can render. Filtering by this set isolates nav
// links from the wordmark and the running-jobs badge. Retired entries stay in
// the set on purpose: a regression that re-adds "My Designs" or "Dashboard"
// shows up as an extra link, not a silent pass.
const NAV_LABELS = [
  "Studio",
  "Shop",
  "Orders",
  "Admin",
  "My Designs",
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
});

describe("SiteHeader bar (signed in)", () => {
  it("is exactly Studio then Shop — no My Designs, no Orders, no Dashboard", async () => {
    h.session = { user: { id: "u1" } };
    render(<SiteHeader cartEnabled={false} />);
    await settle();

    expect(linksWithin(bar())).toEqual([
      ["Studio", "/studio"],
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
  it("holds Orders and, for an admin, Admin", async () => {
    h.session = { user: { id: "u1", email: "a@b.test" } };
    h.headerState = { isAdmin: true, cartCount: 0, runningJobs: 0 };
    render(<SiteHeader cartEnabled={false} />);
    await settle();

    const menu = await openMenu();
    expect(linksWithin(menu)).toEqual([
      // Studio and Shop repeat inside the menu for phones (sm:hidden in the
      // bar's place); the account items follow.
      ["Studio", "/studio"],
      ["Shop", "/shop"],
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

  it("never shows Dashboard or My Designs anywhere", async () => {
    h.session = { user: { id: "u1" } };
    h.headerState = { isAdmin: true, cartCount: 0, runningJobs: 0 };
    render(<SiteHeader cartEnabled />);
    await settle();
    await openMenu();

    expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull();
    expect(screen.queryByRole("link", { name: "My Designs" })).toBeNull();
    expect(screen.queryByText("New Design")).toBeNull();
  });
});

describe("SiteHeader signed out", () => {
  it("shows Studio, Shop and Sign in in the bar, and no Orders anywhere", async () => {
    render(<SiteHeader cartEnabled={false} />);
    await settle();

    expect(linksWithin(bar())).toEqual([
      ["Studio", "/studio"],
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
