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
  publishSeededImage,
  seedConversationImage,
} from "./helpers/db";
import { waitForSessionCookie } from "./helpers/session";
import { signUpFreshAccount } from "./helpers/auth";
import { waitForHydrated } from "./helpers/hydration";

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

    // The page offers Order (an in-page button, not a link to another page):
    // tap it, pick a size, and the Order button, which carries the total only
    // once a size is picked, is enabled. The collapsed panel is
    // server-rendered, so wait for React to attach before the first tap.
    await page.goto(imagePath);

    // Lightbox (#285), artwork while the panel is closed: opens, locks the
    // page behind it, and Escape returns to the same URL.
    const urlBefore = page.url();
    const viewLarger = page.getByRole("button", { name: "View larger" });
    await waitForHydrated(viewLarger);
    await viewLarger.click();
    const viewer = page.getByTestId("fullscreen-viewer");
    await expect(viewer).toBeVisible();
    await expect(page.getByTestId("fullscreen-viewer-close")).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
    expect(page.url()).toBe(urlBefore);

    await waitForHydrated(page.getByTestId("order-expand"));
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
    // Both the panel (which reports its picks) and the strip are
    // server-rendered; wait for each to hydrate before tapping (Total is in
    // the server HTML, so it proves nothing; see helpers/hydration.ts).
    await waitForHydrated(page.getByRole("button", { name: /^Order/ }));
    await waitForHydrated(page.getByTestId("conversation-image-thumb"));
    await page.getByTestId("conversation-image-thumb").first().click();
    await page.getByTestId("image-lightbox").getByRole("link", { name: "Open" }).click();

    await page.waitForURL((url) => url.pathname === `/d/${second}`, { timeout: 30_000 });
    const params = new URL(page.url()).searchParams;
    expect(params.get("order")).toBe("1");
    expect(params.get("size")).toBe("L");
    expect(params.get("color")).toBe("Black");
    await expect(page.getByRole("button", { name: "L", exact: true }).first()).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Black", exact: true }).first()).toHaveAttribute("aria-pressed", "true");
  } finally {
    await cleanupDesigns(seeded);
    if (ownerId) await cleanupUser(ownerId);
  }
});

test("a router.refresh() on the image detail page leaves the open panel and its picks in the address bar (buy panel URL sync)", async ({ page }, testInfo) => {
  const key = `owner-refresh-${Date.now()}-${testInfo.project.name}`;
  const seeded: string[] = [];
  let ownerId = "";
  try {
    await signUpFreshAccount(page, key);
    ownerId = await userIdForSessionCookie(await waitForSessionCookie(page));
    const designId = await seedDesign(ownerId, key);
    seeded.push(designId);
    const imageId = (await primaryImageIdForDesign(designId))!;
    expect(imageId, "seeded design has no primary image").toBeTruthy();
    // Published, and owned by this user: the page then offers them the title
    // editor, whose Save runs a revalidating server action and then
    // router.refresh(). (An unpublished image offers neither, which is why this
    // does not reuse the first test's image.)
    await publishSeededImage(imageId, ownerId, `Before ${key}`);

    await page.goto(`/d/${imageId}`);
    await waitForHydrated(page.getByTestId("order-expand"));
    await page.getByTestId("order-expand").click();
    await page.getByRole("button", { name: "L", exact: true }).click();
    await expect(page).toHaveURL(/[?&]size=L(&|$)/);

    const edit = page.getByRole("button", { name: "Edit", exact: true });
    await waitForHydrated(edit);
    await edit.click();
    const renamed = `Renamed ${Date.now()}`;
    await page.getByPlaceholder("Title").fill(renamed);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // The heading shows the new title only once the router has applied the
    // revalidated page. That commit is where a router that never saw the
    // panel's address-bar writes puts the bar back to the URL the page loaded
    // with (no query), so the checks below run after it.
    await expect(page.getByRole("heading", { name: renamed })).toBeVisible({
      timeout: 30_000,
    });

    const picks = new URL(page.url()).searchParams;
    expect(picks.get("order")).toBe("1");
    expect(picks.get("size")).toBe("L");
    await expect(page.getByTestId("order-expand")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "L", exact: true })
    ).toHaveAttribute("aria-pressed", "true");
  } finally {
    await cleanupDesigns(seeded);
    if (ownerId) await cleanupUser(ownerId);
  }
});
