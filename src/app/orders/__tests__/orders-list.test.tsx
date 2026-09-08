/**
 * Back-thumbnail rendering on /orders (#167). The front/back image swap and
 * contributor derivation are covered by the real-DB integration tests in
 * src/lib/__tests__/user-orders.integration.test.ts; this is presentation
 * only — given a line's already-resolved imageUrl/backImageUrl, does the row
 * show both sides with the right alts and labels.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OrdersList } from "../orders-list";
import type { UserOrder } from "@/lib/user-orders";

function makeOrder(
  lines: UserOrder["lines"],
  overrides: Partial<UserOrder> = {}
): UserOrder {
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
    ...overrides,
  };
}

const LINE: UserOrder["lines"][number] = {
  designId: "d1",
  blankId: "bella-canvas-3001",
  size: "M",
  color: "White",
  quantity: 1,
  imageUrl: "https://img.example/front.png",
  backImageUrl: null,
  designedByName: null,
};

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

describe("OrdersList status tone (Paper)", () => {
  it("colors shipped positive, canceled negative, and leaves paid neutral", () => {
    const shipped = makeOrder([LINE], { id: "order-shipped", status: "shipped" });
    const canceled = makeOrder([LINE], { id: "order-canceled", status: "canceled" });
    const paid = makeOrder([LINE], { id: "order-paid", status: "paid" });

    render(<OrdersList orders={[shipped, canceled, paid]} />);
    // Canceled sorts out of the default "active" filter, so switch to "all"
    // to see every status label at once.
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));

    expect(screen.getByText("Shipped").className).toContain("text-positive");
    expect(screen.getByText("Canceled").className).toContain("text-negative");
    const paidLabel = screen.getByText("Paid");
    expect(paidLabel.className).not.toContain("text-positive");
    expect(paidLabel.className).not.toContain("text-negative");
  });
});

describe("OrdersList order id (Paper)", () => {
  it("renders the short order id in a mono element", () => {
    const order = makeOrder([LINE]);
    render(<OrdersList orders={[order]} />);

    const idEl = screen.getByText(order.id.slice(0, 8));
    expect(idEl.className).toContain("font-mono");
  });
});

describe("OrdersList filters and maker-CTA hrefs (Paper)", () => {
  it("names the three filter buttons with counts and toggles aria-pressed", () => {
    const order = makeOrder([LINE]);
    render(<OrdersList orders={[order]} />);

    const activeBtn = screen.getByRole("button", { name: "Active (1)" });
    const canceledBtn = screen.getByRole("button", { name: "Canceled (0)" });
    const allBtn = screen.getByRole("button", { name: "All (1)" });

    expect(activeBtn).toHaveAttribute("aria-pressed", "true");
    expect(canceledBtn).toHaveAttribute("aria-pressed", "false");
    expect(allBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(canceledBtn);

    expect(screen.getByText("No canceled orders.")).toBeInTheDocument();
    expect(canceledBtn).toHaveAttribute("aria-pressed", "true");
    expect(activeBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("points the header New Design link at /studio", () => {
    const order = makeOrder([LINE]);
    render(<OrdersList orders={[order]} />);

    expect(screen.getByRole("link", { name: "New Design" })).toHaveAttribute(
      "href",
      "/studio"
    );
  });

  it("points the empty-state action at /studio", () => {
    render(<OrdersList orders={[]} />);

    expect(
      screen.getByRole("link", { name: "Make your first design" })
    ).toHaveAttribute("href", "/studio");
  });

  it("renders the ORDERS masthead in the Paper mono label type", () => {
    render(<OrdersList orders={[]} />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Orders");
    expect(heading.className).toContain("font-mono");
    expect(heading.className).toContain("text-[11px]");
    expect(heading.className).toContain("tracking-[0.08em]");
    expect(heading.className).toContain("uppercase");
    expect(heading.className).toContain("text-text-muted");
    expect(heading.className).not.toContain("font-bold");
  });
});
