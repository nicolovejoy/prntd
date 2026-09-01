/**
 * Nav remap (2026-09-01): Studio leads the signed-in link set, "New Design"
 * is gone, and the running-jobs badge points at the Studio instead of My
 * Designs. `useSession`/`getHeaderState` are mocked so the assertions are
 * about the links array, not the round trips underneath it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

// The nav-link labels this remap governs, in the order the header maps them.
// PRNTD (logo), Cart, Feedback, Sign in/out, and the running-jobs badge text
// all fall outside this set, so filtering by it isolates just the nav links.
const NAV_LABELS = ["Studio", "My Designs", "Shop", "Orders", "Dashboard", "Admin"];

function navLinkLabels() {
  return screen
    .getAllByRole("link")
    .map((a) => a.textContent)
    .filter((t): t is string => NAV_LABELS.includes(t ?? ""));
}

async function settle() {
  await waitFor(() => expect(getHeaderState).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  h.session = null;
  h.headerState = { isAdmin: false, cartCount: 0, runningJobs: 0 };
});

describe("SiteHeader signed-in nav", () => {
  it("is exactly Studio, My Designs, Shop, Orders in order, with New Design absent", async () => {
    h.session = { user: { id: "u1" } };
    render(<SiteHeader cartEnabled={false} storesEnabled={false} />);
    await settle();

    expect(navLinkLabels()).toEqual(["Studio", "My Designs", "Shop", "Orders"]);
    expect(screen.queryByText("New Design")).toBeNull();
  });

  it("shows Dashboard only when storesEnabled is true", async () => {
    h.session = { user: { id: "u1" } };
    render(<SiteHeader cartEnabled={false} storesEnabled={true} />);
    await settle();

    expect(navLinkLabels()).toEqual([
      "Studio",
      "My Designs",
      "Shop",
      "Orders",
      "Dashboard",
    ]);
  });

  it("shows Admin only when getHeaderState reports isAdmin", async () => {
    h.session = { user: { id: "u1" } };
    h.headerState = { isAdmin: true, cartCount: 0, runningJobs: 0 };
    render(<SiteHeader cartEnabled={false} storesEnabled={false} />);
    await settle();

    expect(navLinkLabels()).toEqual([
      "Studio",
      "My Designs",
      "Shop",
      "Orders",
      "Admin",
    ]);
  });
});

describe("SiteHeader signed-out nav", () => {
  it("shows Shop + Sign in only", async () => {
    render(<SiteHeader cartEnabled={false} storesEnabled={false} />);
    await settle();

    expect(navLinkLabels()).toEqual(["Shop"]);
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });
});

describe("running-jobs badge", () => {
  it("links to /studio", async () => {
    h.session = { user: { id: "u1" } };
    h.headerState = { isAdmin: false, cartCount: 0, runningJobs: 2 };
    render(<SiteHeader cartEnabled={false} storesEnabled={false} />);

    const badge = await screen.findByTestId("running-jobs-badge");
    expect(badge.getAttribute("href")).toBe("/studio");
  });
});
