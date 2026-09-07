/**
 * Maker landing: the signed-out homepage is a composer. Submitting an idea
 * navigates to /design?prompt=…, which auto-fires one generation.
 * The thin-prompt test uses a deliberately vague idea so the fast readiness
 * check answers with a clarifying question — CI never pays for a render there.
 *
 * Anchored on structure, not marketing copy. The hero renders, the composer
 * and chips are there. No price is asserted: the homepage no longer states
 * one anywhere, and the hero's old "from $X, shipped" line was removed for
 * claiming a delivered price that excluded shipping. Chips are drawn
 * randomly from a 300-prompt library
 * (`pickExamplePrompts`), so the exact text isn't predictable — assertions
 * check the hero renders exactly 3 chips and each is a real library member,
 * not a specific string.
 */
import { test, expect, type Locator } from "@playwright/test";
import { EXAMPLES } from "../src/lib/design-examples";

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

  // Example chips: exactly 3, each a real member of the prompt library
  // (chips are drawn randomly, so the text itself isn't predictable).
  const chips = hero.getByTestId("example-chip");
  await expect(chips).toHaveCount(3);
  const chipTexts = await chips.allTextContents();
  for (const text of chipTexts) {
    expect(EXAMPLES).toContain(text);
  }
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

  const firstChip = hero.getByTestId("example-chip").first();
  const chipText = await firstChip.textContent();
  expect(chipText).not.toBeNull();
  await firstChip.click();

  await expect(page).toHaveURL(/\/design/);
  await expect(page.getByTestId("chat-message-user").first()).toHaveText(
    chipText ?? ""
  );
});
