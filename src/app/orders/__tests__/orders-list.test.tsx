/**
 * Back-thumbnail rendering on /orders (#167). The front/back image swap and
 * contributor derivation are covered by the real-DB integration tests in
 * src/lib/__tests__/user-orders.integration.test.ts; this is presentation
 * only — given a line's already-resolved imageUrl/backImageUrl, does the row
 * show both sides with the right alts and labels.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OrdersList } from "../orders-list";
import type { UserOrder } from "@/lib/user-orders";

function makeOrder(lines: UserOrder["lines"]): UserOrder {
  return {
    id: "order-1",
    status: "paid",
    totalPrice: 27.43,
    trackingNumber: null,
    trackingUrl: null,
    createdAt: new Date("2026-09-01"),
    archivedAt: null,
    displayName: null,
    lines,
  };
}

describe("OrdersList back thumbnails (#167)", () => {
  it("renders both sides with mono labels when the line has a back pin", () => {
    const order = makeOrder([
      {
        designId: "d1",
        blankId: "bella-canvas-3001",
        size: "M",
        color: "White",
        quantity: 1,
        imageUrl: "https://img.example/front.png",
        backImageUrl: "https://img.example/back.png",
        designedByName: null,
      },
    ]);

    render(<OrdersList orders={[order]} />);

    expect(screen.getByAltText("Front design")).toBeInTheDocument();
    expect(screen.getByAltText("Back design")).toBeInTheDocument();
    expect(screen.getByText("Front")).toBeInTheDocument();
    expect(screen.getByText("Back")).toBeInTheDocument();
  });

  it("renders only the front, no labels, when the line has no back", () => {
    const order = makeOrder([
      {
        designId: "d1",
        blankId: "bella-canvas-3001",
        size: "M",
        color: "White",
        quantity: 1,
        imageUrl: "https://img.example/front.png",
        backImageUrl: null,
        designedByName: null,
      },
    ]);

    render(<OrdersList orders={[order]} />);

    expect(screen.getByAltText("Front design")).toBeInTheDocument();
    expect(screen.queryByAltText("Back design")).not.toBeInTheDocument();
    expect(screen.queryByText("Front")).not.toBeInTheDocument();
    expect(screen.queryByText("Back")).not.toBeInTheDocument();
  });
});
