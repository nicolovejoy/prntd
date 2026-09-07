import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { NoticeSheet, useNotice } from "../notice-sheet";

describe("NoticeSheet", () => {
  it("renders title and body when open", () => {
    render(<NoticeSheet open title="Image not deleted" body="It may be on an order." onClose={() => {}} />);
    expect(screen.getByText("Image not deleted")).toBeInTheDocument();
    expect(screen.getByText("It may be on an order.")).toBeInTheDocument();
    expect(screen.getByTestId("notice-sheet")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(<NoticeSheet open={false} title="Image not deleted" onClose={() => {}} />);
    expect(screen.queryByTestId("notice-sheet")).not.toBeInTheDocument();
  });

  it("defaults the button label to Close and honors an override", () => {
    const { unmount } = render(<NoticeSheet open title="Nope" onClose={() => {}} />);
    expect(screen.getByTestId("notice-sheet-close")).toHaveTextContent("Close");
    unmount();
    render(<NoticeSheet open title="Nope" closeLabel="Got it" onClose={() => {}} />);
    expect(screen.getByTestId("notice-sheet-close")).toHaveTextContent("Got it");
  });

  it("focuses the close button on open", () => {
    render(<NoticeSheet open title="Nope" onClose={() => {}} />);
    expect(screen.getByTestId("notice-sheet-close")).toHaveFocus();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<NoticeSheet open title="Nope" onClose={onClose} />);
    fireEvent.click(screen.getByTestId("notice-sheet-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<NoticeSheet open title="Nope" onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

function Harness() {
  const { notice, element } = useNotice();
  const [count, setCount] = useState(0);
  return (
    <>
      {element}
      <button type="button" onClick={() => { notice({ title: `Failure ${count}` }); setCount((n) => n + 1); }}>
        fail
      </button>
    </>
  );
}

describe("useNotice", () => {
  it("shows nothing until notice() is called", () => {
    render(<Harness />);
    expect(screen.queryByTestId("notice-sheet")).not.toBeInTheDocument();
  });

  it("shows the sheet on notice() and dismisses it on Close", async () => {
    render(<Harness />);
    await act(async () => { fireEvent.click(screen.getByText("fail")); });
    expect(screen.getByText("Failure 0")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByTestId("notice-sheet-close")); });
    expect(screen.queryByTestId("notice-sheet")).not.toBeInTheDocument();
  });

  it("replaces an open notice with the newer one", async () => {
    render(<Harness />);
    await act(async () => { fireEvent.click(screen.getByText("fail")); });
    await act(async () => { fireEvent.click(screen.getByText("fail")); });
    expect(screen.getByText("Failure 1")).toBeInTheDocument();
    expect(screen.queryByText("Failure 0")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("notice-sheet")).toHaveLength(1);
  });
});
