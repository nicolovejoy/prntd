import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { ConfirmSheet, useConfirm } from "../confirm-sheet";

describe("ConfirmSheet", () => {
  it("renders title and body when open", () => {
    render(
      <ConfirmSheet
        open
        title="Delete this conversation?"
        body="Images used elsewhere are kept."
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText("Delete this conversation?")).toBeInTheDocument();
    expect(screen.getByText("Images used elsewhere are kept.")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-sheet")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(
      <ConfirmSheet open={false} title="Delete?" onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(screen.queryByTestId("confirm-sheet")).not.toBeInTheDocument();
  });

  it("defaults confirmLabel to Delete and cancelLabel to Cancel", () => {
    render(<ConfirmSheet open title="Delete?" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByTestId("confirm-sheet-confirm")).toHaveTextContent("Delete");
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("honors custom confirmLabel and cancelLabel", () => {
    render(
      <ConfirmSheet
        open
        title="Retry?"
        confirmLabel="Retry"
        cancelLabel="Not now"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByTestId("confirm-sheet-confirm")).toHaveTextContent("Retry");
    expect(screen.getByText("Not now")).toBeInTheDocument();
  });

  it("calls onConfirm when the confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(<ConfirmSheet open title="Delete?" onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.click(screen.getByTestId("confirm-sheet-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(<ConfirmSheet open title="Delete?" onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the backdrop is clicked", () => {
    const onCancel = vi.fn();
    render(<ConfirmSheet open title="Delete?" onConfirm={() => {}} onCancel={onCancel} />);
    // The Modal backdrop is the outer fixed/inset-0 div; content clicks stop
    // propagation, so clicking the sheet's testid ancestor two levels up
    // reaches the backdrop.
    const backdrop = screen.getByTestId("confirm-sheet").parentElement!.parentElement!;
    fireEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel and preventDefaults Escape", () => {
    const onCancel = vi.fn();
    render(<ConfirmSheet open title="Delete?" onConfirm={() => {}} onCancel={onCancel} />);
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("focuses the cancel button on open (safe default)", () => {
    render(<ConfirmSheet open title="Delete?" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Cancel")).toHaveFocus();
  });

  it("disables both buttons when busy", () => {
    render(
      <ConfirmSheet open title="Delete?" busy onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(screen.getByTestId("confirm-sheet-confirm")).toBeDisabled();
    expect(screen.getByText("Cancel")).toBeDisabled();
  });
});

describe("useConfirm", () => {
  function Harness({ onResult }: { onResult: (v: boolean) => void }) {
    const { confirm, element } = useConfirm();
    const [busy, setBusy] = useState(false);
    return (
      <div>
        <button
          onClick={async () => {
            setBusy(true);
            const result = await confirm({ title: "Delete this?", body: "Gone for good." });
            setBusy(false);
            onResult(result);
          }}
        >
          trigger
        </button>
        {busy ? <span>busy</span> : null}
        {element}
      </div>
    );
  }

  it("resolves true when the confirm button is clicked", async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    fireEvent.click(screen.getByText("trigger"));
    expect(await screen.findByTestId("confirm-sheet")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("confirm-sheet-confirm"));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });

  it("resolves false when the cancel button is clicked", async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    fireEvent.click(screen.getByText("trigger"));
    await screen.findByTestId("confirm-sheet");
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it("resolves false on Escape", async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    fireEvent.click(screen.getByText("trigger"));
    await screen.findByTestId("confirm-sheet");
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
      );
    });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it("resolves false on backdrop click", async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    fireEvent.click(screen.getByText("trigger"));
    await screen.findByTestId("confirm-sheet");
    const backdrop = screen.getByTestId("confirm-sheet").parentElement!.parentElement!;
    fireEvent.click(backdrop);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it("renders the sheet with the passed title and body", async () => {
    render(<Harness onResult={() => {}} />);
    fireEvent.click(screen.getByText("trigger"));
    expect(await screen.findByText("Delete this?")).toBeInTheDocument();
    expect(screen.getByText("Gone for good.")).toBeInTheDocument();
  });

  it("a second confirm() while one is open resolves the first as false and shows the new one", async () => {
    function DoubleHarness({ onFirst, onSecond }: { onFirst: (v: boolean) => void; onSecond: (v: boolean) => void }) {
      const { confirm, element } = useConfirm();
      return (
        <div>
          <button
            onClick={() => {
              confirm({ title: "First" }).then(onFirst);
            }}
          >
            first
          </button>
          <button
            onClick={() => {
              confirm({ title: "Second" }).then(onSecond);
            }}
          >
            second
          </button>
          {element}
        </div>
      );
    }
    const onFirst = vi.fn();
    const onSecond = vi.fn();
    render(<DoubleHarness onFirst={onFirst} onSecond={onSecond} />);
    fireEvent.click(screen.getByText("first"));
    expect(await screen.findByText("First")).toBeInTheDocument();
    fireEvent.click(screen.getByText("second"));
    await waitFor(() => expect(onFirst).toHaveBeenCalledWith(false));
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.queryByText("First")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("confirm-sheet-confirm"));
    await waitFor(() => expect(onSecond).toHaveBeenCalledWith(true));
  });
});
