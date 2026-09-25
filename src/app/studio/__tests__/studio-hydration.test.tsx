/**
 * Hydration of the Studio bench (React #418, 2026-09-25).
 *
 * The bench renders two clock-derived labels: a lane's "last active" time
 * and a running generation's elapsed time. Both must come out identical in
 * the server HTML and in the client's hydration render, even though the
 * client hydrates a second or more after the server rendered. The page hands
 * the client its own clock reading (`initialNowMs`) for exactly that; the
 * client switches to its own clock once mounted.
 *
 * Each case server-renders, moves the clock (and, where it matters, the time
 * zone), then hydrates the same element and asserts React reported nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { StudioClient } from "../studio-client";
import type { StudioLane } from "@/lib/studio";

vi.mock("../actions", () => ({
  getStudioLanes: vi.fn(async () => []),
  deleteConversations: vi.fn(async () => ({ deleted: [], skipped: [] })),
}));
vi.mock("@/app/design/actions", () => ({
  generateDesign: vi.fn(),
  closeConversation: vi.fn(async () => {}),
  cancelGeneration: vi.fn(async () => true),
}));
vi.mock("@/app/designs/actions", () => ({
  deleteDesign: vi.fn(async () => ({})),
}));

// The page's collaborators, for the wiring test at the bottom.
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/require-user", () => ({
  requireRealUser: vi.fn(async () => ({ user: { id: "user-1" } })),
}));
vi.mock("@/lib/studio", () => ({
  getStudioLanesData: vi.fn(async () => []),
  sweepStudioForUser: vi.fn(async () => {}),
}));

// The server's clock reading when it rendered the page.
const T = Date.parse("2026-09-25T16:00:00.000Z");

let container: HTMLDivElement;
let root: Root | null;
let recoverable: unknown[];

beforeEach(() => {
  recoverable = [];
  root = null;
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function runningLane(): StudioLane {
  return {
    designId: "design-1",
    title: "geometric wolf head",
    // 59.5 s before the server rendered: "just now" there, "1m ago" 1.5 s
    // later on the client.
    lastActiveAt: new Date(T - 59_500),
    cells: [],
    // 25.4 s into the render on the server ("0:25"), 26.9 s on the client
    // ("0:26").
    pending: [
      { jobId: "job-1", generationNumber: 1, startedAt: new Date(T - 25_400) },
    ],
  };
}

/** Render at `serverNow`, then hydrate the same element at `clientNow`. */
async function serverThenHydrate(
  element: React.ReactElement,
  serverNow: number,
  clientNow: number
) {
  const now = vi.spyOn(Date, "now").mockReturnValue(serverNow);
  container.innerHTML = renderToString(element);
  now.mockReturnValue(clientNow);
  await act(async () => {
    root = hydrateRoot(container, element, {
      onRecoverableError: (error) => recoverable.push(error),
    });
  });
}

describe("StudioClient hydration", () => {
  it("hydrates a running generation without a clock mismatch", async () => {
    await serverThenHydrate(
      <StudioClient initialLanes={[runningLane()]} initialNowMs={T} />,
      T,
      T + 1_500
    );

    expect(recoverable).toEqual([]);
  });

  it("switches to the browser's clock once hydrated", async () => {
    await serverThenHydrate(
      <StudioClient initialLanes={[runningLane()]} initialNowMs={T} />,
      T,
      T + 1_500
    );

    expect(container.textContent).toContain("0:26");
    expect(container.textContent).toContain("1m ago");
    expect(container.textContent).not.toContain("0:25");
    expect(container.textContent).not.toContain("just now");
  });

  it("hydrates a lane older than 30 days without a time-zone mismatch", async () => {
    // Vercel renders in UTC; the browser hydrates in the viewer's zone.
    // 03:00 UTC on Aug 11 is Aug 10 in Pacific time.
    const lastActiveAt = new Date("2026-08-11T03:00:00.000Z");
    const serverNow = lastActiveAt.getTime() + 45 * 24 * 60 * 60 * 1000;
    const element = (
      <StudioClient
        initialLanes={[
          {
            designId: "design-old",
            title: "a returning lane",
            lastActiveAt,
            cells: [],
            pending: [],
          },
        ]}
        initialNowMs={serverNow}
      />
    );

    const original = process.env.TZ;
    try {
      const now = vi.spyOn(Date, "now").mockReturnValue(serverNow);
      process.env.TZ = "UTC";
      container.innerHTML = renderToString(element);
      process.env.TZ = "America/Los_Angeles";
      now.mockReturnValue(serverNow + 1_500);
      await act(async () => {
        root = hydrateRoot(container, element, {
          onRecoverableError: (error) => recoverable.push(error),
        });
      });
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }

    expect(recoverable).toEqual([]);
    expect(container.textContent).toContain("8/10/2026");
  });
});

describe("Studio page wiring", () => {
  it("hands the client the server's clock reading", async () => {
    const { default: StudioPage } = await import("../page");

    const before = Date.now();
    const element = await StudioPage();
    const after = Date.now();

    expect(element.type).toBe(StudioClient);
    const { initialNowMs } = element.props as { initialNowMs?: number };
    expect(typeof initialNowMs).toBe("number");
    expect(initialNowMs).toBeGreaterThanOrEqual(before);
    expect(initialNowMs).toBeLessThanOrEqual(after);
  });
});
