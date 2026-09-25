/**
 * /orders server-renders its list (#141), so each order's date is printed
 * twice: once by the server (UTC on Vercel) and again by the browser at
 * hydration (the viewer's zone). A date formatted in the process's own zone
 * reads differently in the two for any order placed between 00:00 UTC and
 * the Pacific midnight, which fails hydration (React #418, the same class as
 * the Studio's lane dates). Dates are shown as Pacific calendar days.
 */
import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { OrdersList } from "../orders-list";
import type { UserOrder } from "@/lib/user-orders";

// 03:00 UTC on Aug 11 is still Aug 10 in Pacific time.
const ORDER: UserOrder = {
  id: "order-1",
  status: "paid",
  totalPrice: 27.43,
  trackingNumber: null,
  trackingUrl: null,
  createdAt: new Date("2026-08-11T03:00:00.000Z"),
  archivedAt: null,
  displayName: null,
  lines: [
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
  ],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("OrdersList hydration", () => {
  it("prints the same Pacific date on a UTC server and in a Pacific browser", async () => {
    const element = <OrdersList orders={[ORDER]} />;
    const recoverable: unknown[] = [];
    const original = process.env.TZ;
    container = document.createElement("div");
    document.body.appendChild(container);

    try {
      process.env.TZ = "UTC";
      container.innerHTML = renderToString(element);
      process.env.TZ = "America/Los_Angeles";
      await act(async () => {
        root = hydrateRoot(container!, element, {
          onRecoverableError: (error) => recoverable.push(error),
        });
      });
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }

    expect(recoverable).toEqual([]);
    expect(container.textContent).toContain("Aug 10, 2026");
  });
});
