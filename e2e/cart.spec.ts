/**
 * Multi-item cart (#26 Stage B), as a guest: seed two designs owned by the
 * browser's anonymous user, add both to the cart from /order, check the
 * bundled-shipping invariant (charged once per order, flat across items), and
 * hit the purchase gate (guests are sent to sign-in at checkout).
 */
import { test, expect, type Page } from "@playwright/test";
import {
  userIdForSessionCookie,
  seedDesign,
  cleanupDesigns,
} from "./helpers/db";
import { waitForSessionCookie } from "./helpers/session";

const PRODUCT = "bella-canvas-3001";

async function shippingAmount(page: Page): Promise<number> {
  const row = page.getByText("Shipping (bundled)").locator("..");
  const text = await row.innerText();
  const match = text.match(/\$(\d+\.\d{2})/);
  expect(match, `no $ amount in shipping row: ${text}`).toBeTruthy();
  return Number(match![1]);
}

async function addToCartFromOrderPage(page: Page, designId: string) {
  await page.goto(
    `/order?id=${designId}&product=${PRODUCT}&color=Black&size=M`
  );
  // Pricing loads via a server action; the button is live before that, so
  // wait for the total row to know the page is fully wired.
  await expect(page.getByText("Total")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.waitForURL(/\/cart/);
}

test("guest cart: two items, bundled shipping, sign-in gate at checkout", async ({
  page
}, testInfo) => {
  // Unique per run + project so parallel/mobile+desktop runs don't collide.
  const key = `${Date.now()}-${testInfo.project.name}`;
  const seeded: string[] = [];

  try {
    // Mint the anonymous session, then seed designs it owns (designs are
    // owner-scoped; a guest can only order its own).
    await page.goto("/design");
    const cookie = await waitForSessionCookie(page);
    const userId = await userIdForSessionCookie(cookie);
    seeded.push(await seedDesign(userId, `${key}-a`));
    seeded.push(await seedDesign(userId, `${key}-b`));

    // First item.
    await addToCartFromOrderPage(page, seeded[0]);
    await expect(page.getByTestId("cart-line-item")).toHaveCount(1, {
      timeout: 30_000,
    });
    const oneItemShipping = await shippingAmount(page);

    // Second item — bundled shipping must not scale with item count.
    await addToCartFromOrderPage(page, seeded[1]);
    await expect(page.getByTestId("cart-line-item")).toHaveCount(2, {
      timeout: 30_000,
    });
    const twoItemShipping = await shippingAmount(page);
    expect(twoItemShipping).toBe(oneItemShipping);

    // Purchase gate: a guest checking out is sent to sign-in, not Stripe.
    await page.getByRole("button", { name: /^Checkout/ }).click();
    await page.waitForURL(/\/sign-in/);
    expect(page.url()).toContain("next=");
  } finally {
    await cleanupDesigns(seeded);
  }
});
