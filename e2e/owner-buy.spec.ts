/**
 * One buy surface, slice 3 (#278): the owner of an UNPUBLISHED image orders it
 * from its image detail page with the same panel a Shop buyer uses, and
 * nobody else can open that page. Checkout itself is covered by the nightly
 * Stripe spec (e2e/stripe-money-path.spec.ts); this one stops at the enabled
 * Order button, so it needs no Stripe.
 */
import { test, expect } from "@playwright/test";
import {
  userIdForSessionCookie,
  seedDesign,
  cleanupDesigns,
  cleanupUser,
  primaryImageIdForDesign,
} from "./helpers/db";
import { waitForSessionCookie } from "./helpers/session";
import { signUpFreshAccount } from "./helpers/auth";

test("the owner of an unpublished image can order it; a second signed-in user gets the not-found page (#278)", async ({
  page,
  browser,
}, testInfo) => {
  const key = `owner-buy-${Date.now()}-${testInfo.project.name}`;
  const seeded: string[] = [];
  let ownerId = "";
  let otherId = "";
  const otherContext = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
  });

  try {
    // A real account that owns an image no one has published.
    await signUpFreshAccount(page, key);
    ownerId = await userIdForSessionCookie(await waitForSessionCookie(page));
    const designId = await seedDesign(ownerId, key);
    seeded.push(designId);
    const imageId = await primaryImageIdForDesign(designId);
    expect(imageId, "seeded design has no primary image").toBeTruthy();
    const imagePath = `/d/${imageId}`;

    // The page offers Order (not a link out to /preview): tap it, pick a
    // size, and the Order button, which carries the total only once a size is
    // picked, is enabled.
    await page.goto(imagePath);

    // Lightbox (#285), artwork while the panel is closed: opens, locks the
    // page behind it, and Escape returns to the same URL.
    const urlBefore = page.url();
    await page.getByRole("button", { name: "View larger" }).click();
    const viewer = page.getByTestId("fullscreen-viewer");
    await expect(viewer).toBeVisible();
    await expect(page.getByTestId("fullscreen-viewer-close")).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
    expect(page.url()).toBe(urlBefore);

    await page.getByTestId("order-expand").click();
    await expect(page).not.toHaveURL(/\/preview/);
    await page.getByRole("button", { name: "L", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /^Order — \$\d/ })
    ).toBeEnabled();

    // Lightbox (#285), mockup once the panel is open. CI's Printful key is a
    // stub, so the render may show its error overlay above the hero's select
    // button; open it by keyboard so the check does not depend on the render.
    const urlWithPicks = page.url();
    const heroButton = page
      .getByTestId("side-hero")
      .getByRole("button", { name: "View larger" });
    await heroButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("fullscreen-viewer")).toBeVisible();
    await page.getByTestId("fullscreen-viewer-close").click();
    await expect(page.getByTestId("fullscreen-viewer")).toHaveCount(0);
    expect(page.url()).toBe(urlWithPicks);

    // A second signed-in user, in their own browser context, opening the same
    // URL gets the not-found page, and no Order panel.
    const other = await otherContext.newPage();
    await signUpFreshAccount(other, `${key}-other`);
    otherId = await userIdForSessionCookie(await waitForSessionCookie(other));
    await other.goto(imagePath);
    await expect(other.getByText(/could not be found/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(other.getByTestId("order-expand")).toHaveCount(0);
  } finally {
    await otherContext.close();
    await cleanupDesigns(seeded);
    if (ownerId) await cleanupUser(ownerId);
    if (otherId) await cleanupUser(otherId);
  }
});
