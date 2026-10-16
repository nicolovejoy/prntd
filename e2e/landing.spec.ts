/**
 * Maker landing: the signed-out homepage is a composer. Submitting an idea
 * (or tapping an example chip) goes to /design?prompt=…, the one route a
 * visitor with no session can open. There a thin client page mints the guest
 * session and replaces itself with /studio?prompt=…&lane=…&seed=…; the Studio
 * fires one generation from it (#188 slice 2b).
 *
 * CI runs with fake vendor keys, so that generation fails as soon as it asks
 * Claude for the brief, before any job row exists. The assertions are
 * therefore about what the visitor keeps and what is recorded, not about an
 * image: the address carries the idea, the bench shows one lane for it, and a
 * reload fires nothing more (the guest's user turns, which generateDesign
 * writes before the brief call, stay at one).
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
import { test, expect, type Locator, type Page } from "@playwright/test";
import { EXAMPLES } from "../src/lib/design-examples";
import { waitForSessionCookie } from "./helpers/session";
import { userIdForSessionCookie, userTurnCountForUser } from "./helpers/db";

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

/**
 * The landing hop's end state, checked after a submit or a chip tap: the
 * Studio, with the idea in the address, one lane on the bench, and exactly
 * one fire recorded for the guest (one user turn) — also after a reload,
 * which must neither add a lane nor fire the idea again.
 */
async function expectLandingIdeaOnTheBench(page: Page, idea: string) {
  // 20 s: the guest mint behind the hop can be rate-limited (3 sign-ins per
  // 10 s per IP) and is then retried once after about 10 s.
  await expect(page).toHaveURL(/\/studio\?/, { timeout: 20_000 });
  expect(new URL(page.url()).searchParams.get("prompt")).toBe(idea);
  await expect(page.getByTestId("studio-lane")).toHaveCount(1);

  const userId = await userIdForSessionCookie(await waitForSessionCookie(page));
  await expect.poll(() => userTurnCountForUser(userId)).toBe(1);

  await page.reload();
  await expect(page.getByTestId("studio-lane")).toHaveCount(1);
  // The seed's mount effect runs at hydration, and its server action lands
  // within a moment of it. Give a second fire that long to show itself; the
  // localStorage mark is what keeps the count at one.
  await page.waitForTimeout(2_000);
  expect(await userTurnCountForUser(userId)).toBe(1);
  await expect(page.getByTestId("studio-lane")).toHaveCount(1);
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

test("an idea typed on the landing page opens the Studio and fires one generation", async ({
  page,
}) => {
  const idea = `a heron in tall reeds ${Date.now()}`;
  await page.goto("/");
  const hero = page.getByTestId("maker-hero");
  await hero.getByRole("textbox").fill(idea);
  // Enabled means React owns the input, so the typed value will submit.
  await expect(submitButton(hero)).toBeEnabled();
  await submitButton(hero).click();

  await expectLandingIdeaOnTheBench(page, idea);
});

test("tapping an example chip opens the Studio with the chip as the idea", async ({
  page,
}) => {
  await page.goto("/");
  const hero = page.getByTestId("maker-hero");
  await waitForHeroHydration(hero);

  const firstChip = hero.getByTestId("example-chip").first();
  const chipText = await firstChip.textContent();
  expect(chipText).not.toBeNull();
  await firstChip.click();

  await expectLandingIdeaOnTheBench(page, chipText ?? "");
});
