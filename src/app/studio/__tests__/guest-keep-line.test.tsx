/**
 * The guest sign-up line on both Studio views (#241).
 *
 * The pages decide whether to show it from requireStudioUser's `isGuest`; the
 * gate itself is pinned in src/lib/__tests__/require-user.test.ts. Here the
 * gate and the data readers are mocked so the test is only about what each
 * page renders for a guest versus a real account.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  gate: {
    session: { user: { id: "u1", isAnonymous: false } },
    isGuest: false,
  },
}));

vi.mock("@/lib/require-user", () => ({
  requireStudioUser: vi.fn(async () => h.gate),
}));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/lib/studio", () => ({
  getStudioLanesData: vi.fn(async () => []),
  sweepStudioForUser: vi.fn(async () => {}),
}));
vi.mock("@/lib/user-designs", () => ({
  getUserImageLibrary: vi.fn(async () => []),
}));
// The bench's client component pulls the whole generation stack; the page's
// own decision is all that is under test here.
vi.mock("../studio-client", () => ({
  StudioClient: () => <div data-testid="studio-client-stub" />,
}));
// Same for the library grid, whose bulk delete imports the auth stack.
vi.mock("../library/library-grid", () => ({
  LibraryGrid: () => <div data-testid="library-grid-stub" />,
}));

const { GuestKeepLine, GUEST_KEEP_COPY } = await import("../guest-keep-line");
const { default: StudioPage } = await import("../page");
const { default: StudioLibraryPage } = await import("../library/page");
const { getStudioLanesData } = await import("@/lib/studio");
const { getUserImageLibrary } = await import("@/lib/user-designs");

function asGuest() {
  h.gate = {
    session: { user: { id: "guest-1", isAnonymous: true } },
    isGuest: true,
  };
}

beforeEach(() => {
  h.gate = {
    session: { user: { id: "u1", isAnonymous: false } },
    isGuest: false,
  };
  vi.mocked(getStudioLanesData).mockClear();
  vi.mocked(getUserImageLibrary).mockClear();
});

describe("GuestKeepLine", () => {
  it("links to sign-up with the persona-C line", () => {
    render(<GuestKeepLine />);
    const link = screen.getByTestId("guest-keep-line");
    expect(link).toHaveAttribute("href", "/sign-up");
    expect(link.textContent).toBe(GUEST_KEEP_COPY);
    expect(GUEST_KEEP_COPY).toBe("Sign up to keep these designs.");
  });
});

describe("/studio (bench)", () => {
  it("shows the sign-up line to a guest and reads the guest's own lanes", async () => {
    asGuest();
    render(await StudioPage());
    expect(screen.getByTestId("guest-keep-line")).toHaveAttribute(
      "href",
      "/sign-up"
    );
    expect(screen.getByTestId("studio-client-stub")).toBeTruthy();
    expect(getStudioLanesData).toHaveBeenCalledWith("guest-1");
  });

  it("shows no sign-up line to a real account", async () => {
    render(await StudioPage());
    expect(screen.queryByTestId("guest-keep-line")).toBeNull();
    expect(getStudioLanesData).toHaveBeenCalledWith("u1");
  });
});

describe("/studio/library", () => {
  it("shows the sign-up line to a guest and reads the guest's own images", async () => {
    asGuest();
    render(await StudioLibraryPage());
    expect(screen.getByTestId("guest-keep-line")).toBeTruthy();
    expect(getUserImageLibrary).toHaveBeenCalledWith("guest-1");
  });

  it("shows no sign-up line to a real account", async () => {
    render(await StudioLibraryPage());
    expect(screen.queryByTestId("guest-keep-line")).toBeNull();
    expect(getUserImageLibrary).toHaveBeenCalledWith("u1");
  });
});
