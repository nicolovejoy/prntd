/**
 * Organizer product-compose flow (Phase 2 slice 2), as a *claimed* account:
 * sign up a real organizer, seed a design with artwork they own, create a shop
 * from the dashboard, add a product, exercise the live proceeds box + the
 * below-floor warning, save, and confirm the shop's product count rises.
 *
 * Compose gates on a non-anonymous account (getComposableDesigns returns [] for
 * guests), so this is the one funnel surface the anon session helper can't
 * cover. STORES_ENABLED is set in the Playwright webServer env.
 */
import { test, expect } from "@playwright/test";
import {
  userIdForSessionCookie,
  seedDesign,
  cleanupDesigns,
  cleanupStoresAndProducts,
  cleanupUser,
} from "./helpers/db";
import { waitForSessionCookie } from "./helpers/session";
import { signUpFreshAccount } from "./helpers/auth";

test("organizer compose: create shop, add product, proceeds + floor warning, save", async ({
  page,
}, testInfo) => {
  const key = `${Date.now()}-${testInfo.project.name}`;
  const shopName = `E2E Shop ${key}`;
  const seeded: string[] = [];
  let ownerId = "";

  try {
    // Real claimed organizer (not the anon guest session).
    await signUpFreshAccount(page, key);
    const cookie = await waitForSessionCookie(page);
    ownerId = await userIdForSessionCookie(cookie);

    // A design with artwork the new account owns — compose's picker source.
    // (Real generation needs Replicate; seed the row directly.)
    seeded.push(await seedDesign(ownerId, key));

    // Create a shop from the dashboard.
    await page.goto("/dashboard");
    await page.getByPlaceholder(/Shop name/).fill(shopName);
    await page.getByRole("button", { name: "Create a shop" }).click();

    // The new store's card. Scope every later interaction to it so leftover
    // stores from a prior failed run can't shadow the buttons.
    const card = page.locator("div.rounded-lg").filter({ hasText: shopName });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText(/^0 products$/)).toBeVisible();

    // Add a product.
    await card.getByRole("button", { name: "Add product" }).click();
    await page.waitForURL(/\/dashboard\/products\/new/);

    // The seeded design loads into the picker and auto-selects (the preview
    // image only renders once a design is selected).
    await expect(page.getByAltText("preview")).toBeVisible({ timeout: 30_000 });

    // Live proceeds box is present; default price is above floor → no warning.
    await expect(page.getByText("Your team gets", { exact: true })).toBeVisible();
    const floorWarn = page.getByText(/your team receives less than \$5/);
    await expect(floorWarn).toBeHidden();

    // Drop the price below the floor → the warning appears.
    const priceInput = page.locator('input[type="number"]');
    await priceInput.fill("6");
    await expect(floorWarn).toBeVisible();

    // Raise it back above the floor → the warning clears.
    await priceInput.fill("25");
    await expect(floorWarn).toBeHidden();

    // Save → back to the dashboard, product count rises.
    await page.getByRole("button", { name: "Add to shop" }).click();
    await page.waitForURL(/\/dashboard$/);
    const savedCard = page.locator("div.rounded-lg").filter({ hasText: shopName });
    await expect(savedCard.getByText(/^1 product$/)).toBeVisible({ timeout: 15_000 });
  } finally {
    // Products + stores FK to user, so they go before the user row.
    await cleanupStoresAndProducts(ownerId);
    await cleanupDesigns(seeded);
    await cleanupUser(ownerId);
  }
});
