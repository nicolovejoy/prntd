/**
 * Same parked bug as /admin: handleAddTag left a stale Retry/Recover/Refund
 * failure line on screen next to the freshly added tag.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import OrderDetailPage from "../page";

const getOrderDetail = vi.fn();
const retryPrintfulSubmission = vi.fn();
const setOrderTags = vi.fn();

vi.mock("../../../actions", () => ({
  getOrderDetail: (...a: unknown[]) => getOrderDetail(...a),
  retryPrintfulSubmission: (...a: unknown[]) => retryPrintfulSubmission(...a),
  recoverPendingOrder: vi.fn(),
  refundOrder: vi.fn(),
  archiveOrder: vi.fn(),
  unarchiveOrder: vi.fn(),
  setOrderClassification: vi.fn(),
  setOrderTags: (...a: unknown[]) => setOrderTags(...a),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "11111111-2222-3333-4444-555555555555" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/orders/11111111-2222-3333-4444-555555555555",
}));

const ORDER = {
  id: "11111111-2222-3333-4444-555555555555",
  displayName: null,
  status: "paid",
  userEmail: "buyer@example.com",
  designImageUrl: null,
  lines: [
    {
      blankId: "bella-canvas-3001",
      size: "M",
      color: "Black",
      quantity: 1,
      placements: {},
      imageUrl: null,
      title: null,
      designedByName: null,
    },
  ],
  totalPrice: 24.12,
  printfulCost: null,
  printfulOrderId: null,
  stripeSessionId: null,
  stripePaymentIntentId: null,
  trackingUrl: null,
  createdAt: new Date("2026-09-01T12:00:00Z"),
  archivedAt: null,
  classification: null,
  tags: null,
  shippingName: null,
  shippingAddress1: null,
  shippingAddress2: null,
  shippingCity: null,
  shippingState: null,
  shippingZip: null,
  shippingCountry: null,
  ledger: [],
};

beforeEach(() => {
  getOrderDetail.mockReset();
  retryPrintfulSubmission.mockReset();
  setOrderTags.mockReset();
  getOrderDetail.mockResolvedValue(ORDER);
  retryPrintfulSubmission.mockRejectedValue(new Error("printful down"));
  setOrderTags.mockResolvedValue(undefined);
});

async function raiseStaleNotice() {
  fireEvent.click(await screen.findByRole("button", { name: /Retry Printful/ }));
  fireEvent.click(await screen.findByTestId("confirm-sheet-confirm"));
  await screen.findByTestId("admin-action-result");
}

describe("order detail add-tag clears the previous result line", () => {
  it("removes a stale failure line when a tag is added", async () => {
    render(<OrderDetailPage />);
    await raiseStaleNotice();

    const input = screen.getByPlaceholderText("+tag");
    fireEvent.change(input, { target: { value: "rush" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(screen.queryByTestId("admin-action-result")).toBeNull()
    );
    expect(setOrderTags).toHaveBeenCalledWith(ORDER.id, ["rush"]);
  });

  it("leaves the line alone when the tag is already present", async () => {
    getOrderDetail.mockResolvedValue({ ...ORDER, tags: ["rush"] });
    render(<OrderDetailPage />);
    await raiseStaleNotice();

    const input = screen.getByPlaceholderText("+tag");
    fireEvent.change(input, { target: { value: "rush" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByTestId("admin-action-result")).toBeInTheDocument();
    expect(setOrderTags).not.toHaveBeenCalled();
  });
});
