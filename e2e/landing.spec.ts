/**
 * Maker landing ("Type It, Wear It"): the signed-out homepage is a composer.
 * Submitting an idea navigates to /design?prompt=…, which auto-fires Draw-it.
 * The thin-prompt test uses a deliberately vague idea so the fast readiness
 * check answers with a clarifying question — CI never pays for a render there.
 */
import { test, expect } from "@playwright/test";
import { EXAMPLES } from "../src/lib/design-examples";

test("signed-out homepage shows the hero composer", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Type an idea. Wear it." })
  ).toBeVisible();
  await expect(page.getByPlaceholder(/Describe your design/)).toBeVisible();
});

test("a thin prompt seeds /design and gets a clarifying reply", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByPlaceholder(/Describe your design/).fill("something cool");
  await page.getByRole("button", { name: "Draw it" }).click();

  await expect(page).toHaveURL(/\/design/);
  // The seed shows up as the first user turn.
  await expect(page.getByTestId("chat-message-user").first()).toHaveText(
    "something cool"
  );
  // Thin-check replies with a clarifying question (no image render).
  await expect(page.getByTestId("chat-message-assistant").first()).toBeVisible({
    timeout: 30_000,
  });
  // The prompt param was stripped on arrival, so refresh/back won't resubmit.
  expect(new URL(page.url()).searchParams.has("prompt")).toBe(false);
});

test("tapping an example chip lands on /design with the chip as the first turn", async ({
  page,
}) => {
  await page.goto("/");
  const chip = EXAMPLES[0];
  await page.getByRole("button", { name: chip }).click();

  await expect(page).toHaveURL(/\/design/);
  await expect(page.getByTestId("chat-message-user").first()).toHaveText(chip);
});
