/**
 * #188 slice 2c: /design never renders the old chat thread. An old
 * /design?id= link redirects on the server: a signed-in owner of a
 * conversation with a result lands on that conversation's stage in the
 * Studio, anyone else on the bench, and a visitor with no session goes to
 * sign-in and is brought back to the same link.
 */
import { test, expect } from "@playwright/test";
import {
  userIdForSessionCookie,
  seedDesign,
  seedPublishedImage,
  cleanupDesigns,
  cleanupUser,
  primaryImageIdForDesign,
} from "./helpers/db";
import { waitForSessionCookie } from "./helpers/session";
import { waitForHydrated } from "./helpers/hydration";
import { signUpFreshAccount } from "./helpers/auth";

test("an old /design?id= link opens the Studio stage; a foreign or unknown id opens the bench (#188 slice 2c)", async ({ page }, testInfo) => {
  const key = `design-redirect-${Date.now()}-${testInfo.project.name}`;
  const seeded: string[] = [];
  let ownerId = "";
  let sellerId = "";
  try {
    await signUpFreshAccount(page, key);
    ownerId = await userIdForSessionCookie(await waitForSessionCookie(page));
    const mine = await seedDesign(ownerId, `${key}-mine`);
    seeded.push(mine);
    const image = (await primaryImageIdForDesign(mine))!;
    const seller = await seedPublishedImage(`${key}-seller`, "E2E redirect seller");
    seeded.push(seller.designId);
    sellerId = seller.sellerId;

    // 1. My conversation: the stage on its primary result, not a chat page.
    await page.goto(`/design?id=${mine}`);
    await page.waitForURL(
      (url) =>
        url.pathname === "/studio" &&
        url.searchParams.get("conversation") === mine &&
        url.searchParams.get("image") === image,
      { timeout: 30_000 }
    );
    await expect(page.getByTestId("focused-stage")).toBeVisible();

    // 2. Someone else's conversation: the bench, and nothing of theirs in the address.
    await page.goto(`/design?id=${seller.designId}`);
    await page.waitForURL((url) => url.pathname === "/studio" && url.search === "", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("focused-stage")).toHaveCount(0);
    expect(page.url()).not.toContain(seller.imageId);

    // 3. An id that matches nothing: the bench too.
    await page.goto(`/design?id=e2e-no-such-design-${key}`);
    await page.waitForURL((url) => url.pathname === "/studio" && url.search === "", {
      timeout: 30_000,
    });
  } finally {
    await cleanupDesigns(seeded);
    if (sellerId) await cleanupUser(sellerId);
    if (ownerId) await cleanupUser(ownerId);
  }
});

test("the image detail page opens the Studio stage on its image, from Open conversation and from New design from this image (#188 slice 2c)", async ({ page }, testInfo) => {
  const key = `design-redirect-d-${Date.now()}-${testInfo.project.name}`;
  const seeded: string[] = [];
  let ownerId = "";
  try {
    await signUpFreshAccount(page, key);
    ownerId = await userIdForSessionCookie(await waitForSessionCookie(page));
    const mine = await seedDesign(ownerId, key);
    seeded.push(mine);
    const image = (await primaryImageIdForDesign(mine))!;

    // 1. Open conversation: the stage of that conversation on this image.
    await page.goto(`/d/${image}`);
    const open = page.getByTestId("open-conversation");
    await waitForHydrated(open);
    await open.click();
    await page.waitForURL(
      (url) =>
        url.pathname === "/studio" &&
        url.searchParams.get("conversation") === mine &&
        url.searchParams.get("image") === image,
      { timeout: 30_000 }
    );
    await expect(page.getByTestId("focused-stage")).toBeVisible();

    // 2. New design from this image: a new conversation whose one cell is this image.
    await page.goto(`/d/${image}`);
    const start = page.getByTestId("start-from-image");
    await waitForHydrated(start);
    await start.click();
    await page.waitForURL(
      (url) =>
        url.pathname === "/studio" &&
        url.searchParams.get("image") === image &&
        Boolean(url.searchParams.get("conversation")) &&
        url.searchParams.get("conversation") !== mine,
      { timeout: 30_000 }
    );
    await expect(page.getByTestId("focused-stage")).toBeVisible();
    // The new conversation holds a seed link; remove it with the account.
    const fresh = new URL(page.url()).searchParams.get("conversation")!;
    seeded.push(fresh);
  } finally {
    await cleanupDesigns(seeded);
    if (ownerId) await cleanupUser(ownerId);
  }
});

test("signed out, an old /design?id= link goes to sign-in and comes back to it (#188 slice 2c)", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const page = await context.newPage();
    await page.goto("/design?id=e2e-not-mine");
    await page.waitForURL(
      (url) =>
        url.pathname === "/sign-in" &&
        url.searchParams.get("next") === "/design?id=e2e-not-mine",
      { timeout: 30_000 }
    );
  } finally {
    await context.close();
  }
});
