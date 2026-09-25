/**
 * The guest line on both Studio views (#241):
 * "Sign up to keep these designs. Have an account? Sign in."
 *
 * The pages get `isGuest` from requireStudioUser; the gate itself is pinned
 * in src/lib/__tests__/require-user.test.ts. Here the gate and the data
 * readers are mocked so the test is only about what each view renders for a
 * guest versus a real account, and that an empty view shows no line. The
 * bench's own show/hide (it follows the rendered lanes, optimistic ones
 * included) is covered in studio-client.test.tsx; this file checks the bench
 * page hands `isGuest` through.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LibraryImage } from "@/lib/user-designs";

const h = vi.hoisted(() => ({
  gate: {
    session: { user: { id: "u1", isAnonymous: false } },
    isGuest: false,
  },
  studioClientProps: null as unknown,
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
// own hand-off is all that is under test here.
vi.mock("../studio-client", () => ({
  StudioClient: (props: unknown) => {
    h.studioClientProps = props;
    return <div data-testid="studio-client-stub" />;
  },
}));
// Same for the library grid, whose bulk delete imports the auth stack.
vi.mock("../library/library-grid", () => ({
  LibraryGrid: () => <div data-testid="library-grid-stub" />,
}));

const { GuestKeepLine } = await import("../guest-keep-line");
const { default: StudioPage } = await import("../page");
const { default: StudioLibraryPage } = await import("../library/page");
const { getStudioLanesData } = await import("@/lib/studio");
const { getUserImageLibrary } = await import("@/lib/user-designs");

const ONE_IMAGE: LibraryImage = {
  imageId: "img-1",
  imageUrl: "https://example.com/img-1.png",
  createdAt: new Date("2026-09-01T00:00:00Z"),
  isPublished: false,
  backgroundColor: null,
  sourceDesignId: "design-1",
  isArchived: false,
};

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
  h.studioClientProps = null;
  vi.mocked(getStudioLanesData).mockClear();
  vi.mocked(getUserImageLibrary).mockReset();
  vi.mocked(getUserImageLibrary).mockResolvedValue([]);
});

describe("GuestKeepLine", () => {
  it("reads as one persona-C sentence pair", () => {
    render(<GuestKeepLine />);
    expect(screen.getByTestId("guest-keep-line").textContent).toBe(
      "Sign up to keep these designs. Have an account? Sign in."
    );
  });

  it("links to sign-up and to sign-in (either one re-parents the guest's work)", () => {
    render(<GuestKeepLine />);
    expect(
      screen.getByRole("link", { name: "Sign up to keep these designs." })
    ).toHaveAttribute("href", "/sign-up");
    expect(screen.getByRole("link", { name: "Sign in." })).toHaveAttribute(
      "href",
      "/sign-in"
    );
  });

  it("gives both links a 44px tap target on phones, underlined", () => {
    render(<GuestKeepLine />);
    for (const id of ["guest-sign-up", "guest-sign-in"]) {
      const cls = screen.getByTestId(id).className;
      expect(cls).toContain("min-h-11");
      expect(cls).toContain("underline");
    }
  });
});

describe("/studio (bench page)", () => {
  it("hands isGuest to the bench and reads the guest's own lanes", async () => {
    asGuest();
    render(await StudioPage());
    expect(h.studioClientProps).toMatchObject({ isGuest: true });
    expect(getStudioLanesData).toHaveBeenCalledWith("guest-1");
  });

  it("hands isGuest=false for a real account", async () => {
    render(await StudioPage());
    expect(h.studioClientProps).toMatchObject({ isGuest: false });
    expect(getStudioLanesData).toHaveBeenCalledWith("u1");
  });
});

describe("/studio/library", () => {
  it("shows the line to a guest with images, and reads the guest's own images", async () => {
    asGuest();
    vi.mocked(getUserImageLibrary).mockResolvedValue([ONE_IMAGE]);
    render(await StudioLibraryPage());
    expect(screen.getByTestId("guest-keep-line")).toBeTruthy();
    expect(getUserImageLibrary).toHaveBeenCalledWith("guest-1");
  });

  it("shows no line to a guest with an empty library", async () => {
    asGuest();
    render(await StudioLibraryPage());
    expect(screen.queryByTestId("guest-keep-line")).toBeNull();
    expect(screen.getByTestId("empty-state")).toBeTruthy();
  });

  it("shows no line to a real account", async () => {
    vi.mocked(getUserImageLibrary).mockResolvedValue([ONE_IMAGE]);
    render(await StudioLibraryPage());
    expect(screen.queryByTestId("guest-keep-line")).toBeNull();
    expect(getUserImageLibrary).toHaveBeenCalledWith("u1");
  });
});
