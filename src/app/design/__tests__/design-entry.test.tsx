/**
 * The thin sessionless /design entry (#188 slice 2b): it mints the guest
 * session, then replaces itself with the Studio address for the landing
 * idea. Nothing navigates before the mint settles.
 *
 * It leaves with window.location.replace, not router.replace: the site header's
 * getHeaderState action posts on mount and again when the mint changes the
 * session, and a concurrent action can swallow a client-side navigation (the
 * 2026-09-08 sign-in hang; CLAUDE.md, Runtime gotchas).
 *
 * A mint that Better-Auth rate-limits (429, 3 sign-ins per 10 s per IP) is
 * retried once on its own after the stated wait, with the status line still
 * showing; a second failure, or any other failure, shows the line and Try again.
 */
import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import {
  DESIGN_ENTRY_FAILED,
  DESIGN_ENTRY_OPENING,
  DESIGN_ENTRY_RETRY,
} from "@/lib/action-copy";
import { GuestSessionError } from "@/lib/guest-session-error";
import { parseSeed } from "@/lib/studio-seed";

const h = vi.hoisted(() => ({
  replace: vi.fn(),
  ensure: vi.fn(),
  order: [] as string[],
}));

vi.mock("@/lib/ensure-guest-session", () => ({
  ensureGuestSession: () => h.ensure(),
}));

import { DesignEntry } from "../design-entry";

/** A promise the test settles by hand. */
function deferred() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tooMany = (retryAfterSeconds: number | null = null) =>
  new GuestSessionError("Too many requests", 429, retryAfterSeconds);

/** Replace window.location with a stub that records replace(); jsdom would
 * not navigate anyway. */
let restoreLocation: (() => void) | null = null;
function stubLocationReplace() {
  const original = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { replace: h.replace },
  });
  restoreLocation = () =>
    Object.defineProperty(window, "location", { configurable: true, value: original });
}

beforeEach(() => {
  vi.clearAllMocks();
  // The component logs a failed mint; keep the run quiet.
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.order = [];
  // mockReset, not just clearAllMocks: a test that leaves a queued
  // mockResolvedValueOnce unconsumed would feed the next test.
  h.ensure.mockReset();
  h.replace.mockReset();
  h.ensure.mockImplementation(async () => {
    h.order.push("ensure");
  });
  h.replace.mockImplementation(() => {
    h.order.push("replace");
  });
  stubLocationReplace();
});

afterEach(() => {
  restoreLocation?.();
  restoreLocation = null;
  vi.useRealTimers();
});

describe("DesignEntry", () => {
  it("shows the status line while the session is minted, and does not navigate yet", async () => {
    const d = deferred();
    h.ensure.mockImplementation(() => {
      h.order.push("ensure");
      return d.promise;
    });
    render(<DesignEntry prompt="a heron" />);

    const status = screen.getByRole("status");
    expect(status.textContent).toBe(DESIGN_ENTRY_OPENING);
    expect(DESIGN_ENTRY_OPENING).toBe("Opening the Studio…");
    await act(async () => {});
    expect(h.ensure).toHaveBeenCalledTimes(1);
    expect(h.replace).not.toHaveBeenCalled();

    await act(async () => {
      d.resolve();
    });
    expect(h.replace).toHaveBeenCalledTimes(1);
  });

  it("mints the session before it replaces", async () => {
    render(<DesignEntry prompt="a heron" />);
    await waitFor(() => expect(h.replace).toHaveBeenCalled());
    expect(h.order).toEqual(["ensure", "replace"]);
  });

  it("leaves with a document navigation, not a router push", async () => {
    render(<DesignEntry prompt="a heron" />);
    await waitFor(() => expect(h.replace).toHaveBeenCalledTimes(1));
  });

  it("replaces with a complete seed address for the prompt", async () => {
    render(<DesignEntry prompt="a heron in tall reeds & ink" />);
    await waitFor(() => expect(h.replace).toHaveBeenCalledTimes(1));

    const href = h.replace.mock.calls[0][0] as string;
    expect(href.startsWith("/studio?")).toBe(true);
    const parsed = parseSeed(new URL(href, "http://prntd.invalid").searchParams);
    expect(parsed).toMatchObject({
      kind: "complete",
      seed: { prompt: "a heron in tall reeds & ink" },
    });
  });

  it("replaces with the bare Studio when there is no prompt", async () => {
    render(<DesignEntry prompt={null} />);
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/studio"));
  });

  it("still navigates when the lookup resolves without minting (the proxy decides)", async () => {
    h.ensure.mockResolvedValue(undefined);
    render(<DesignEntry prompt={null} />);
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/studio"));
  });

  it("shows the failure line and a Try again button when the mint rejects, and does not navigate", async () => {
    h.ensure.mockRejectedValueOnce(new Error("network"));
    render(<DesignEntry prompt="a heron" />);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(DESIGN_ENTRY_FAILED));
    expect(DESIGN_ENTRY_FAILED).toBe("Couldn't start a session. Try again.");
    const button = screen.getByRole("button", { name: DESIGN_ENTRY_RETRY });
    expect(button.textContent).toBe("Try again");
    expect(button.className).toContain("min-h-11");
    expect(screen.queryByRole("status")).toBeNull();
    expect(h.replace).not.toHaveBeenCalled();
    // Not a rate limit: no automatic second attempt.
    expect(h.ensure).toHaveBeenCalledTimes(1);
  });

  it("a non-429 refusal (500) fails at once, with no automatic retry", async () => {
    vi.useFakeTimers();
    h.ensure.mockRejectedValue(new GuestSessionError("boom", 500));
    render(<DesignEntry prompt="a heron" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(screen.getByRole("alert").textContent).toBe(DESIGN_ENTRY_FAILED);
    expect(h.ensure).toHaveBeenCalledTimes(1);
  });

  it("Try again runs the same steps again and then navigates", async () => {
    h.ensure.mockRejectedValueOnce(new Error("network"));
    render(<DesignEntry prompt="a heron" />);
    await waitFor(() => screen.getByRole("button", { name: DESIGN_ENTRY_RETRY }));

    fireEvent.click(screen.getByRole("button", { name: DESIGN_ENTRY_RETRY }));

    await waitFor(() => expect(h.replace).toHaveBeenCalledTimes(1));
    expect(h.ensure).toHaveBeenCalledTimes(2);
    const href = h.replace.mock.calls[0][0] as string;
    expect(
      parseSeed(new URL(href, "http://prntd.invalid").searchParams)
    ).toMatchObject({ kind: "complete", seed: { prompt: "a heron" } });
  });

  it("goes back to the status line while a retry is in flight", async () => {
    h.ensure.mockRejectedValueOnce(new Error("network"));
    render(<DesignEntry prompt={null} />);
    await waitFor(() => screen.getByRole("button", { name: DESIGN_ENTRY_RETRY }));

    const d = deferred();
    h.ensure.mockImplementationOnce(() => d.promise);
    fireEvent.click(screen.getByRole("button", { name: DESIGN_ENTRY_RETRY }));

    expect(screen.getByRole("status").textContent).toBe(DESIGN_ENTRY_OPENING);
    expect(screen.queryByRole("button")).toBeNull();
    await act(async () => {
      d.resolve();
    });
  });

  it("a second failure shows the line again", async () => {
    h.ensure.mockRejectedValue(new Error("network"));
    render(<DesignEntry prompt={null} />);
    await waitFor(() => screen.getByRole("button", { name: DESIGN_ENTRY_RETRY }));
    fireEvent.click(screen.getByRole("button", { name: DESIGN_ENTRY_RETRY }));
    await waitFor(() => expect(h.ensure).toHaveBeenCalledTimes(2));
    await waitFor(() => screen.getByRole("button", { name: DESIGN_ENTRY_RETRY }));
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("Strict Mode's double effect makes one mint and one navigation", async () => {
    render(
      <StrictMode>
        <DesignEntry prompt="a heron" />
      </StrictMode>
    );
    await waitFor(() => expect(h.replace).toHaveBeenCalled());
    await act(async () => {});
    expect(h.ensure).toHaveBeenCalledTimes(1);
    expect(h.replace).toHaveBeenCalledTimes(1);
  });
});

describe("DesignEntry when the mint is rate-limited (429)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("keeps the status line, waits 10 s, retries once, then navigates", async () => {
    h.ensure.mockRejectedValueOnce(tooMany()).mockResolvedValueOnce(undefined);
    render(<DesignEntry prompt="a heron" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.ensure).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toBe(DESIGN_ENTRY_OPENING);
    expect(screen.queryByRole("alert")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_900);
    });
    // Still waiting: no second attempt, no failure line, no navigation.
    expect(h.ensure).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(h.replace).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(h.ensure).toHaveBeenCalledTimes(2);
    expect(h.replace).toHaveBeenCalledTimes(1);
    const href = h.replace.mock.calls[0][0] as string;
    expect(parseSeed(new URL(href, "http://prntd.invalid").searchParams)).toMatchObject({
      kind: "complete",
      seed: { prompt: "a heron" },
    });
  });

  it("waits the stated Retry-After instead of 10 s", async () => {
    h.ensure.mockRejectedValueOnce(tooMany(3)).mockResolvedValueOnce(undefined);
    render(<DesignEntry prompt={null} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(h.ensure).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(h.ensure).toHaveBeenCalledTimes(2);
    expect(h.replace).toHaveBeenCalledWith("/studio");
  });

  it("never waits more than 15 s", async () => {
    h.ensure.mockRejectedValueOnce(tooMany(120)).mockResolvedValueOnce(undefined);
    render(<DesignEntry prompt={null} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_100);
    });
    expect(h.ensure).toHaveBeenCalledTimes(2);
    expect(h.replace).toHaveBeenCalledTimes(1);
  });

  it("a second 429 shows the failure line and Try again, and does not retry again", async () => {
    h.ensure.mockRejectedValue(tooMany());
    render(<DesignEntry prompt="a heron" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_100);
    });
    expect(h.ensure).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert").textContent).toBe(DESIGN_ENTRY_FAILED);
    expect(screen.getByRole("button", { name: DESIGN_ENTRY_RETRY })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(h.ensure).toHaveBeenCalledTimes(2);
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("a non-429 failure on the retry shows the failure line", async () => {
    h.ensure.mockRejectedValueOnce(tooMany()).mockRejectedValueOnce(new Error("network"));
    render(<DesignEntry prompt={null} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_100);
    });
    expect(screen.getByRole("alert").textContent).toBe(DESIGN_ENTRY_FAILED);
  });

  it("Try again after a double 429 gets its own automatic retry", async () => {
    h.ensure
      .mockRejectedValueOnce(tooMany())
      .mockRejectedValueOnce(tooMany())
      .mockRejectedValueOnce(tooMany())
      .mockResolvedValueOnce(undefined);
    render(<DesignEntry prompt={null} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_100);
    });
    expect(screen.getByRole("alert")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: DESIGN_ENTRY_RETRY }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_100);
    });
    expect(h.ensure).toHaveBeenCalledTimes(4);
    expect(h.replace).toHaveBeenCalledTimes(1);
  });

  it("does not navigate if the page was left during the wait", async () => {
    h.ensure.mockRejectedValueOnce(tooMany()).mockResolvedValueOnce(undefined);
    const { unmount } = render(<DesignEntry prompt={null} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("Strict Mode still makes one wait and one retry", async () => {
    h.ensure.mockRejectedValueOnce(tooMany()).mockResolvedValueOnce(undefined);
    render(
      <StrictMode>
        <DesignEntry prompt="a heron" />
      </StrictMode>
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_100);
    });
    expect(h.ensure).toHaveBeenCalledTimes(2);
    expect(h.replace).toHaveBeenCalledTimes(1);
  });
});
