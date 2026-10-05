/**
 * Guest funnel (#26 Stage A): the design → preview → order surface is open to
 * signed-out visitors, who get an anonymous Better-Auth session; personal
 * record routes stay behind sign-in.
 *
 * #241: the Studio bench and My Designs (/designs, moved out from under the
 * Studio 2026-09-27, revising nav model A) are open to that anonymous session too,
 * with a "Sign up to keep these designs. Have an account? Sign in." line. A
 * visitor with no session at all is still sent to sign-in, and /orders
 * still refuses a guest.
 */
import { test, expect } from "@playwright/test";
import { waitForSessionCookie } from "./helpers/session";
import {
  cleanupDesigns,
  cleanupUser,
  seedDesign,
  seedPublishedImage,
  userIdForSessionCookie,
} from "./helpers/db";

test("/design loads for a signed-out visitor", async ({ page }) => {
  await page.goto("/design");
  await expect(page).not.toHaveURL(/sign-in/);
  // Empty-state hero composer is the whole page when there's no content.
  await expect(
    page.getByRole("textbox", { name: "Describe a design" }).first()
  ).toBeVisible();
});

test("a guest on /design gets an anonymous session", async ({ page }) => {
  await page.goto("/design");
  await waitForSessionCookie(page);
});

test("personal routes still redirect a visitor with no session to sign-in", async ({
  page,
}) => {
  await page.goto("/designs");
  await expect(page).toHaveURL(/sign-in/);
  await page.goto("/orders");
  await expect(page).toHaveURL(/sign-in/);
});

test("a guest with an anonymous session reaches their own Studio, not /orders", async ({
  page,
}, testInfo) => {
  const key = `guest-studio-${Date.now()}-${testInfo.project.name}`;
  const seeded: string[] = [];

  try {
    await page.goto("/design");
    const cookie = await waitForSessionCookie(page);
    const userId = await userIdForSessionCookie(cookie);
    const designId = await seedDesign(userId, key);
    seeded.push(designId);

    // Bench: the guest's own lane, plus the sign-up/sign-in line.
    await page.goto("/studio");
    await expect(page).toHaveURL(/\/studio$/);
    await expect(page.getByTestId("guest-keep-line")).toBeVisible();
    await expect(page.getByTestId("guest-sign-up")).toHaveAttribute(
      "href",
      "/sign-up"
    );
    await expect(page.getByTestId("guest-sign-in")).toHaveAttribute(
      "href",
      "/sign-in"
    );
    await expect(page.getByTestId("studio-lane")).toHaveCount(1);

    // My Designs: the guest's own image, plus the same line.
    await page.goto("/designs");
    await expect(page).toHaveURL(/\/designs$/);
    await expect(page.getByTestId("guest-keep-line")).toBeVisible();
    // My Designs' line carries next, so sign-up/sign-in return here.
    await expect(page.getByTestId("guest-sign-up")).toHaveAttribute(
      "href",
      "/sign-up?next=%2Fdesigns"
    );
    await expect(page.getByTestId("guest-sign-in")).toHaveAttribute(
      "href",
      "/sign-in?next=%2Fdesigns"
    );
    await expect(page.getByTestId("library-tile")).toHaveCount(1);

    // The old /studio/library address still 308s here, carrying the query.
    await page.goto("/studio/library?from=x");
    await expect(page).toHaveURL(/\/designs\?from=x$/);

    // Orders stay real-account-only.
    await page.goto("/orders");
    await expect(page).toHaveURL(/sign-in/);
  } finally {
    await cleanupDesigns(seeded);
  }
});

test("a guest's size and colour on the image detail page survive Sign in to buy and sign-up (#278)", async ({
  page,
}, testInfo) => {
  const key = `guest-buy-picks-${Date.now()}-${testInfo.project.name}`;
  let seededDesign = "";
  let sellerId = "";
  let anonUserId = "";
  let claimedUserId = "";

  try {
    const seeded = await seedPublishedImage(key, `Buy picks ${key}`);
    seededDesign = seeded.designId;
    sellerId = seeded.sellerId;
    const imagePath = `/d/${seeded.imageId}`;

    // A guest session, minted the way a first-time visitor gets one.
    await page.goto("/design");
    anonUserId = await userIdForSessionCookie(await waitForSessionCookie(page));

    await page.goto(imagePath);
    await page.getByTestId("order-expand").click();
    await page.getByRole("button", { name: "L", exact: true }).click();
    // A colour that is not the default (White), so the check below can tell
    // the link's pick from the default.
    await page.getByTitle("Black", { exact: true }).click();
    await expect(page).toHaveURL(/[?&]size=L(&|$)/);
    await expect(page).toHaveURL(/[?&]color=Black(&|$)/);

    // Sign in to buy -> sign-in page -> its Sign up link, which carries next.
    await page.getByRole("link", { name: "Sign in to buy" }).click();
    await expect(page).toHaveURL(/\/sign-in\?next=/);
    await page.getByRole("link", { name: "Sign up", exact: true }).click();
    await expect(page).toHaveURL(/\/sign-up\?next=/);
    await page.getByPlaceholder("Name").fill("E2E Buyer");
    await page.getByPlaceholder("Email").fill(`e2e-buyer-${key}@prntd.test`);
    await page.getByPlaceholder("Password").fill("e2e-password-123");
    await page.getByRole("button", { name: /Sign up/ }).click();

    // Read the new account's id as soon as it exists, before any assertion
    // that could fail, so the cleanup below always knows it (the claim mints
    // a new session for a different user than the guest's). Mid-claim the
    // browser can still hold the guest's cookie after its session row is
    // deleted, so a missing row means "not yet", not a failure.
    await expect
      .poll(
        async () => {
          const cookie = await waitForSessionCookie(page);
          try {
            claimedUserId = await userIdForSessionCookie(cookie);
          } catch {
            return anonUserId;
          }
          return claimedUserId;
        },
        { timeout: 30_000 }
      )
      .not.toBe(anonUserId);

    // Back on the same image, panel open, size and colour kept.
    await expect(
      page,
      "sign-up did not return to the image detail page"
    ).toHaveURL(new RegExp(`${imagePath}\\?`), { timeout: 30_000 });
    await expect(page.getByTestId("order-expand")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "L", exact: true })
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Color \u2014 Black")).toBeVisible();
    // Signed in now: one tap on Order is available (not tapped here; the
    // Stripe specs cover checkout).
    await expect(
      page.getByRole("button", { name: /^Order \u2014 \$\d/ })
    ).toBeEnabled();
  } finally {
    // Designs first (the mirror product FKs the seller), then every account
    // the run made. The guest row is normally already gone after a claim;
    // cleanupUser on a missing row deletes nothing.
    if (seededDesign) await cleanupDesigns([seededDesign]);
    if (sellerId) await cleanupUser(sellerId);
    if (claimedUserId) await cleanupUser(claimedUserId);
    if (anonUserId) await cleanupUser(anonUserId);
  }
});
