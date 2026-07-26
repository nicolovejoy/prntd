/**
 * Maker landing: the signed-out homepage is a composer. Submitting an idea
 * navigates to /design?prompt=…, which auto-fires one generation.
 * The thin-prompt test uses a deliberately vague idea so the fast readiness
 * check answers with a clarifying question — CI never pays for a render there.
 *
 * Anchored on structure, not marketing copy. An earlier cut asserted the hero
 * headline verbatim and broke when a copy sweep rewrote it; what matters is
 * that the hero rendered, the composer and chips are there, and the price line
 * carries the real minRetailPrice(). Chip text is imported from the module the
 * page renders, so it tracks edits rather than drifting.
 */
import { test, expect, type Locator } from "@playwright/test";
import { EXAMPLES } from "../src/lib/design-examples";
import { minRetailPrice } from "../src/lib/pricing";

const CHIPS = EXAMPLES.slice(0, 3);

const submitButton = (hero: Locator) =>
  hero.locator('form button[type="submit"]');

/**
 * The hero is server-rendered and React attaches a moment later; a chip
 * clicked before that silently no-ops (seen on a cold server). Typing enables
 * the submit button purely through React state — it ships disabled in the
 * server HTML — so that transition is the hydration signal.
 */
async function waitForHeroHydration(hero: Locator) {
  await hero.getByRole("textbox").fill("x");
  await expect(submitButton(hero)).toBeEnabled();
  await hero.getByRole("textbox").fill("");
}

test("signed-out homepage shows the hero composer", async ({ page }) => {
  await page.goto("/");
  const hero = page.getByTestId("maker-hero");
  await expect(hero).toBeVisible();

  // Composer: an input and a submit control.
  await expect(hero.getByRole("textbox")).toBeVisible();
  await expect(submitButton(hero)).toBeVisible();

  // Example chips.
  for (const chip of CHIPS) {
    await expect(hero.getByRole("button", { name: chip })).toBeVisible();
  }

  // Price line — the amount, not the sentence around it.
  const price = minRetailPrice().toFixed(2).replace(".", "\\.");
  await expect(hero.getByText(new RegExp(`\\$${price}`))).toBeVisible();
});

test("a thin prompt seeds /design and gets a clarifying reply", async ({
  page,
}) => {
  await page.goto("/");
  const hero = page.getByTestId("maker-hero");
  await hero.getByRole("textbox").fill("something cool");
  // Enabled means React owns the input, so the typed value will submit.
  await expect(submitButton(hero)).toBeEnabled();
  await submitButton(hero).click();

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
  const hero = page.getByTestId("maker-hero");
  await waitForHeroHydration(hero);

  const chip = CHIPS[0];
  await hero.getByRole("button", { name: chip }).click();

  await expect(page).toHaveURL(/\/design/);
  await expect(page.getByTestId("chat-message-user").first()).toHaveText(chip);
});
