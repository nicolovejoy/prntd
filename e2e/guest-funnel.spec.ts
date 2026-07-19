/**
 * Guest funnel (#26 Stage A): the design → preview → order surface is open to
 * signed-out visitors, who get an anonymous Better-Auth session; personal
 * record routes stay behind sign-in.
 */
import { test, expect } from "@playwright/test";
import { waitForSessionCookie } from "./helpers/session";

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

test("personal routes still redirect signed-out visitors to sign-in", async ({
  page,
}) => {
  await page.goto("/designs");
  await expect(page).toHaveURL(/sign-in/);
  await page.goto("/orders");
  await expect(page).toHaveURL(/sign-in/);
});
