/**
 * One buy surface, slice 4 (#278): an old /preview link opens the image
 * detail page of the image it showed, with the panel open and the same picks.
 * A conversation with no primary image goes to the conversation; /order (which
 * forwards to /preview) still lands; a signed-out visitor goes to sign-in and
 * is brought back to the same link.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  userIdForSessionCookie,
  seedDesign,
  cleanupDesigns,
  cleanupUser,
  primaryImageIdForDesign,
  clearPrimaryImage,
} from "./helpers/db";
import { waitForSessionCookie } from "./helpers/session";
import { signUpFreshAccount } from "./helpers/auth";

const PRODUCT = "bella-canvas-3001";

async function landedOn(page: Page, imageId: string) {
  await page.waitForURL(
    (url) => url.pathname === `/d/${imageId}` && url.searchParams.get("order") === "1",
    { timeout: 30_000 }
  );
  return new URL(page.url()).searchParams;
}

test("an old /preview link opens the image detail page with the same picks (#278 slice 4)", async ({ page }, testInfo) => {
  const key = `preview-redirect-${Date.now()}-${testInfo.project.name}`;
  const seeded: string[] = [];
  let ownerId = "";
  try {
    await signUpFreshAccount(page, key);
    ownerId = await userIdForSessionCookie(await waitForSessionCookie(page));
    const withPrimary = await seedDesign(ownerId, `${key}-a`);
    const noPrimary = await seedDesign(ownerId, `${key}-b`);
    seeded.push(withPrimary, noPrimary);
    const primary = (await primaryImageIdForDesign(withPrimary))!;
    await clearPrimaryImage(noPrimary);

    // 1. A conversation with a primary: its page, panel open.
    await page.goto(`/preview?id=${withPrimary}`);
    await landedOn(page, primary);
    await expect(page.getByTestId("order-expand")).toHaveCount(0);

    // 2. Picks in the query come along.
    await page.goto(`/preview?id=${withPrimary}&product=${PRODUCT}&size=M&color=Black`);
    const picks = await landedOn(page, primary);
    expect(picks.get("product")).toBe(PRODUCT);
    expect(picks.get("size")).toBe("M");
    expect(picks.get("color")).toBe("Black");
    await expect(page.getByRole("button", { name: "M", exact: true }).first()).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Color — Black")).toBeVisible();

    // 3. No primary: the conversation, as /preview did.
    await page.goto(`/preview?id=${noPrimary}`);
    await page.waitForURL(
      (url) => url.pathname === "/design" && url.searchParams.get("id") === noPrimary,
      { timeout: 30_000 }
    );

    // 4. /order forwards to /preview, which redirects on.
    await page.goto(`/order?id=${withPrimary}&size=L`);
    expect((await landedOn(page, primary)).get("size")).toBe("L");
  } finally {
    await cleanupDesigns(seeded);
    if (ownerId) await cleanupUser(ownerId);
  }
});

test("signed out, an old /preview link goes to sign-in and comes back to it (#278 slice 4)", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const page = await context.newPage();
    await page.goto("/preview?id=e2e-not-mine&size=M");
    await page.waitForURL(
      (url) =>
        url.pathname === "/sign-in" &&
        url.searchParams.get("next") === "/preview?id=e2e-not-mine&size=M",
      { timeout: 30_000 }
    );
  } finally {
    await context.close();
  }
});
