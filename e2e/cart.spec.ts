/**
 * Multi-item cart (#26 Stage B), as a guest: seed two designs owned by the
 * browser's anonymous user, add both to the cart from each image's image
 * detail page, check the bundled-shipping invariant (charged once per order,
 * flat across items), and hit the purchase gate (guests are sent to sign-in at
 * checkout).
 */
import { test, expect, type Page } from "@playwright/test";
import {
  userIdForSessionCookie,
  seedDesign,
  cleanupDesigns,
  cartItemsForUser,
  primaryImageIdForDesign,
} from "./helpers/db";
import { waitForSessionCookie } from "./helpers/session";
import { waitForHydrated } from "./helpers/hydration";

const PRODUCT = "bella-canvas-3001";
// Distinct per design so the two cart lines' thumbnails are actually
// distinguishable (seedDesign defaults every design to the same placeholder
// image, which would make a same-src assertion vacuous).
const IMAGE_A = "https://placehold.co/1024x1024/png?text=A";
const IMAGE_B = "https://placehold.co/1024x1024/png?text=B";

async function shippingAmount(page: Page): Promise<number> {
  const row = page.getByText("Shipping (bundled)").locator("..");
  const text = await row.innerText();
  const match = text.match(/\$(\d+\.\d{2})/);
  expect(match, `no $ amount in shipping row: ${text}`).toBeTruthy();
  return Number(match![1]);
}

async function sessionCookie(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return (
    cookies.find((c) => c.name.endsWith("better-auth.session_token"))?.value ??
    ""
  );
}

async function addToCartFromImagePage(page: Page, designId: string) {
  const imageId = await primaryImageIdForDesign(designId);
  expect(imageId, "seeded design has no primary image").toBeTruthy();
  // The link's size pre-selects visibly (no silent default), so no extra click.
  await page.goto(`/d/${imageId}?order=1&product=${PRODUCT}&color=Black&size=M`);
  // The panel is server-rendered from the link's picks, Total and the button
  // included, so neither proves the page is interactive. Wait for React to
  // hydrate the button itself (see helpers/hydration.ts) before clicking.
  const addToCart = page.getByRole("button", { name: "Add to cart" });
  await expect(page.getByText("Total")).toBeVisible({ timeout: 30_000 });
  await waitForHydrated(addToCart);
  await addToCart.first().click();
  await page.waitForURL(/\/cart/);

  // #101 guard. The flake was never "the cart is empty" — the browser landed
  // on /cart and then bounced back to the buy page a beat later, when a server
  // action that was still in flight resolved and Next navigated to the URL
  // that action had been dispatched from. Hold the URL for a moment so a
  // bounce fails here, loudly, instead of as a mystery 0-line-items count.
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/\/cart/);
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
    seeded.push(await seedDesign(userId, `${key}-a`, IMAGE_A));
    seeded.push(await seedDesign(userId, `${key}-b`, IMAGE_B));

    // First item.
    await addToCartFromImagePage(page, seeded[0]);
    await expect(page.getByTestId("cart-line-item")).toHaveCount(1, {
      timeout: 30_000,
    });
    // The cart is owner-scoped, so a session swap mid-flow reads as an empty
    // cart. ensureGuestSession used to mint a second anonymous user whenever
    // the session lookup errored; assert the identity we seeded against is
    // still the one the cart is read under.
    expect(await sessionCookie(page)).toBe(cookie);
    const oneItemShipping = await shippingAmount(page);

    // Second item — bundled shipping must not scale with item count.
    await addToCartFromImagePage(page, seeded[1]);
    await expect(page.getByTestId("cart-line-item")).toHaveCount(2, {
      timeout: 30_000,
    });
    const twoItemShipping = await shippingAmount(page);
    expect(twoItemShipping).toBe(oneItemShipping);

    // The two lines are from two different designs with two different
    // images, not one design counted twice — assert the rendered
    // thumbnails actually differ (both display the design's own artwork,
    // not a shared fallback).
    const thumbSrcs = await page
      .getByTestId("cart-line-item")
      .locator("img")
      .evaluateAll((imgs) => imgs.map((img) => img.getAttribute("src")));
    expect(thumbSrcs).toHaveLength(2);
    expect(new Set(thumbSrcs).size).toBe(2);

    // DB-level check of the checkout hand-off: both cart lines persist through
    // to the point of checkout, each still pointed at its own design and its
    // own pinned front image (the image path pins the page image, which is
    // each design's primary, so the two pins must differ the same way the
    // designs do).
    const cartRows = await cartItemsForUser(userId);
    expect(cartRows.map((r) => r.designId).sort()).toEqual(
      [...seeded].sort()
    );
    const frontPins = cartRows.map((r) => r.placements?.front);
    expect(frontPins.every((f) => typeof f === "string")).toBe(true);
    expect(new Set(frontPins).size).toBe(2);

    // Purchase gate: a guest checking out is sent to sign-in, not Stripe.
    await page.getByRole("button", { name: /^Checkout/ }).click();
    await page.waitForURL(/\/sign-in/);
    expect(page.url()).toContain("next=");
  } finally {
    await cleanupDesigns(seeded);
  }
});

test("cart line: quantity stepper and Edit save back to the same line (#282)", async ({
  page
}, testInfo) => {
  const key = `${Date.now()}-${testInfo.project.name}-edit`;
  const seeded: string[] = [];

  try {
    await page.goto("/design");
    const cookie = await waitForSessionCookie(page);
    const userId = await userIdForSessionCookie(cookie);
    seeded.push(await seedDesign(userId, key, IMAGE_A));

    // The same add as the test above: Black / M.
    await addToCartFromImagePage(page, seeded[0]);

    const line = page.getByTestId("cart-line-item");
    await expect(line).toHaveCount(1, { timeout: 30_000 });
    const quantity = page.getByTestId("cart-line-quantity");
    await expect(quantity).toHaveText("1");

    // Stepper: the buttons call server actions, so wait for hydration, then
    // for the count to move.
    const increase = page.getByRole("button", { name: "Increase quantity" });
    await waitForHydrated(increase);
    await increase.click();
    await expect(quantity).toHaveText("2", { timeout: 30_000 });
    await expect(
      page.getByRole("button", { name: "Decrease quantity" })
    ).toBeEnabled();

    // Edit: opens the image detail page with the line's picks, in edit mode.
    const lineText = await line.innerText();
    const target = / \/ L\b/.test(lineText) ? "M" : "L";
    await page.getByRole("link", { name: "Edit" }).click();
    await expect(page).toHaveURL(/\/d\/[^?]+\?.*line=/, { timeout: 30_000 });
    // The panel renders the CTA twice (desktop inline, mobile sticky bar); a
    // role query skips the display:none twin, `getByTestId(...).first()` does not.
    const save = page.getByRole("button", { name: "Save to cart" });
    await expect(save).toBeVisible({ timeout: 30_000 });
    await waitForHydrated(save);

    // Pick a size that differs from the line's current one, then save back.
    const chip = page.getByRole("button", { name: target, exact: true });
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await save.click();

    await expect(page).toHaveURL(/\/cart$/, { timeout: 30_000 });
    // Same line, new size, quantity kept: no second line was added.
    await expect(page.getByTestId("cart-line-item")).toHaveCount(1);
    await expect(page.getByTestId("cart-line-item")).toContainText(
      ` / ${target}`
    );
    await expect(page.getByTestId("cart-line-quantity")).toHaveText("2");
    expect(await cartItemsForUser(userId)).toHaveLength(1);
  } finally {
    await cleanupDesigns(seeded);
  }
});
