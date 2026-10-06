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
  seedConversationImage,
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
    await page.getByTestId("order-expand").click();
    await expect(page).not.toHaveURL(/\/preview/);
    await page.getByRole("button", { name: "L", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /^Order — \$\d/ })
    ).toBeEnabled();

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

test("switching to another image of the conversation with the panel open keeps size and colour (#278 slice 4)", async ({ page }, testInfo) => {
  const key = `owner-sibling-${Date.now()}-${testInfo.project.name}`;
  const seeded: string[] = [];
  let ownerId = "";
  try {
    await signUpFreshAccount(page, key);
    ownerId = await userIdForSessionCookie(await waitForSessionCookie(page));
    const designId = await seedDesign(ownerId, key, "https://placehold.co/1024x1024/png?text=A");
    seeded.push(designId);
    const first = (await primaryImageIdForDesign(designId))!;
    const second = `e2e-${key}-img2`;
    await seedConversationImage(designId, ownerId, second, "https://placehold.co/1024x1024/png?text=B");

    await page.goto(`/d/${first}?order=1&product=bella-canvas-3001&size=L&color=Black`);
    await expect(page.getByText("Total")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("conversation-image-thumb").first().click();
    await page.getByTestId("image-lightbox").getByRole("link", { name: "Open" }).click();

    await page.waitForURL((url) => url.pathname === `/d/${second}`, { timeout: 30_000 });
    const params = new URL(page.url()).searchParams;
    expect(params.get("order")).toBe("1");
    expect(params.get("size")).toBe("L");
    expect(params.get("color")).toBe("Black");
    await expect(page.getByRole("button", { name: "L", exact: true }).first()).toHaveAttribute("aria-pressed", "true");
  } finally {
    await cleanupDesigns(seeded);
    if (ownerId) await cleanupUser(ownerId);
  }
});
