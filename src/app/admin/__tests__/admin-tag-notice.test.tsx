/**
 * Parked in the #218 alert sweep: handleAddTag was the one handler that did
 * not clear the previous result line, so a stale Retry/Recover failure
 * survived the next interaction and read as a fresh failure of the tag add.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AdminPage from "../page";

const getAdminData = vi.fn();
const retryPrintfulSubmission = vi.fn();
const setOrderTags = vi.fn();

vi.mock("../actions", () => ({
  getAdminData: () => getAdminData(),
  retryPrintfulSubmission: (...a: unknown[]) => retryPrintfulSubmission(...a),
  recoverPendingOrder: vi.fn(),
  archiveOrder: vi.fn(),
  unarchiveOrder: vi.fn(),
  setOrderTags: (...a: unknown[]) => setOrderTags(...a),
  setOrderClassification: vi.fn(),
}));

const PAID_ORDER = {
  id: "11111111-2222-3333-4444-555555555555",
  displayName: null,
  status: "paid",
  userEmail: "buyer@example.com",
  designImageUrl: null,
  lines: [{ blankId: "bella-canvas-3001", size: "M", color: "Black" }],
  totalPrice: 24.12,
  printfulCost: null,
  printfulOrderId: null,
  stripeSessionId: null,
  trackingUrl: null,
  trackingNumber: null,
  createdAt: new Date("2026-09-01T12:00:00Z"),
  archivedAt: null,
  classification: null,
  tags: null,
};

beforeEach(() => {
  getAdminData.mockReset();
  retryPrintfulSubmission.mockReset();
  setOrderTags.mockReset();
  getAdminData.mockResolvedValue({ orders: [PAID_ORDER], ledger: [] });
  retryPrintfulSubmission.mockRejectedValue(new Error("printful down"));
  setOrderTags.mockResolvedValue(undefined);
});

async function raiseStaleNotice() {
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  fireEvent.click(await screen.findByTestId("confirm-sheet-confirm"));
  await screen.findByTestId("admin-action-result");
}

describe("/admin add-tag clears the previous result line", () => {
  it("removes a stale failure line when a tag is added", async () => {
    render(<AdminPage />);
    await raiseStaleNotice();

    const input = screen.getByPlaceholderText("+tag");
    fireEvent.change(input, { target: { value: "vip" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(screen.queryByTestId("admin-action-result")).toBeNull()
    );
    expect(setOrderTags).toHaveBeenCalledWith(PAID_ORDER.id, ["vip"]);
  });

  it("leaves the line alone when the typed tag is empty", async () => {
    render(<AdminPage />);
    await raiseStaleNotice();

    const input = screen.getByPlaceholderText("+tag");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByTestId("admin-action-result")).toBeInTheDocument();
    expect(setOrderTags).not.toHaveBeenCalled();
  });
});
