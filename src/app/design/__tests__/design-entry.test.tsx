/**
 * The thin sessionless /design entry (#188 slice 2b): it mints the guest
 * session, then replaces itself with the Studio address for the landing
 * idea. Nothing navigates before the mint settles.
 */
import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import {
  DESIGN_ENTRY_FAILED,
  DESIGN_ENTRY_OPENING,
  DESIGN_ENTRY_RETRY,
} from "@/lib/action-copy";
import { parseSeed } from "@/lib/studio-seed";

const h = vi.hoisted(() => ({
  replace: vi.fn(),
  ensure: vi.fn(),
  order: [] as string[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: h.replace }),
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

beforeEach(() => {
  vi.clearAllMocks();
  // The component logs a failed mint; keep the run quiet.
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.order = [];
  h.ensure.mockImplementation(async () => {
    h.order.push("ensure");
  });
  h.replace.mockImplementation(() => {
    h.order.push("replace");
  });
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
