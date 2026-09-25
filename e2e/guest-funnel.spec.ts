/**
 * Guest funnel (#26 Stage A): the design → preview → order surface is open to
 * signed-out visitors, who get an anonymous Better-Auth session; personal
 * record routes stay behind sign-in.
 *
 * #241: the Studio (bench + library) is open to that anonymous session too,
 * with a "Sign up to keep these designs. Have an account? Sign in." line. A
 * visitor with no session at all is still sent to sign-in, and /orders
 * still refuses a guest.
 */
import { test, expect } from "@playwright/test";
import { waitForSessionCookie } from "./helpers/session";
import {
  cleanupDesigns,
  seedDesign,
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
  await page.goto("/studio/library");
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

    // Library: the guest's own image, plus the same line.
    await page.goto("/studio/library");
    await expect(page).toHaveURL(/\/studio\/library$/);
    await expect(page.getByTestId("guest-keep-line")).toBeVisible();
    await expect(page.getByTestId("library-tile")).toHaveCount(1);

    // Orders stay real-account-only.
    await page.goto("/orders");
    await expect(page).toHaveURL(/sign-in/);
  } finally {
    await cleanupDesigns(seeded);
  }
});
