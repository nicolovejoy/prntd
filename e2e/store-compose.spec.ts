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

test("organizer compose: create shop, add + edit product, edit shop, list + publish, public storefront", async ({
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

    // Edit the shop: rename it and confirm the slug (shared-link path) is fixed.
    const slug = (await savedCard.getByText(/^\//).first().innerText()).trim();
    await savedCard.getByRole("button", { name: "Edit shop" }).click();
    const panel = page.locator("div.rounded-lg").filter({ hasText: "Accent color" });
    const newName = `${shopName} Edited`;
    await panel.getByRole("textbox").first().fill(newName); // first textbox = name input
    await panel.getByRole("button", { name: "Save" }).click();
    const renamed = page.locator("div.rounded-lg").filter({ hasText: newName });
    await expect(renamed).toBeVisible({ timeout: 15_000 });
    await expect(renamed.getByText(slug, { exact: true })).toBeVisible(); // slug unchanged

    // The product shows its saved price ($25) in the card's product list.
    await expect(renamed.getByText("$25.00")).toBeVisible();

    // Edit the product: change the price, confirm it round-trips to the list.
    await renamed.getByRole("button", { name: "Edit", exact: true }).click(); // product Edit link
    await page.waitForURL(/\/dashboard\/products\/.+\/edit/);
    await expect(page.getByAltText("preview")).toBeVisible({ timeout: 30_000 });
    await page.locator('input[type="number"]').fill("30");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(/\/dashboard$/);
    const finalCard = page.locator("div.rounded-lg").filter({ hasText: newName });
    await expect(finalCard.getByText("$30.00")).toBeVisible({ timeout: 15_000 });

    // List the product + publish the shop. Each toggle is optimistic + fires a
    // server action; wait for each POST to commit before navigating away (a nav
    // would abort the in-flight request and lose the write).
    const dashPost = () =>
      page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().includes("/dashboard")
      );
    const listed = dashPost();
    await finalCard.getByRole("button", { name: "List" }).click();
    await listed;
    const published = dashPost();
    await finalCard.getByRole("button", { name: "Publish" }).click();
    await published;

    // Public storefront: sign out, then browse the live shop as a visitor.
    // On mobile the nav (incl. Sign out) lives behind the hamburger — open it
    // first; on desktop the "Menu" button is hidden so this is a no-op. Sign-out
    // redirects to "/"; wait for that to land before navigating, otherwise goto
    // races the in-flight redirect (→ ERR_ABORTED).
    const shopPath = `/shop/${slug.replace(/^\//, "")}`;
    const menu = page.getByRole("button", { name: "Menu" });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
    await page.goto(shopPath);
    await expect(page.getByRole("heading", { name: newName })).toBeVisible({ timeout: 15_000 });
    const productLink = page.getByRole("link").filter({ hasText: "Classic Tee" });
    await expect(productLink).toBeVisible();
    await productLink.click();
    await page.waitForURL(/\/shop\/.+\/.+/);
    // Browsing is open; the buy gate is sign-in for a signed-out visitor.
    await expect(page.getByRole("button", { name: "Sign in to buy" })).toBeVisible();
  } finally {
    // Products + stores FK to user, so they go before the user row.
    await cleanupStoresAndProducts(ownerId);
    await cleanupDesigns(seeded);
    await cleanupUser(ownerId);
  }
});
