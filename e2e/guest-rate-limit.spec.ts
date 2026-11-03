import { expect, test } from "@playwright/test";
import { E2E_SIGNIN_RATE_MAX } from "./helpers/rate-limit";
import { waitForSessionCookie } from "./helpers/session";

// Runs in its own Playwright project, alone, after the mobile and desktop
// projects (playwright.config.ts). It fills the sign-in limiter's window for
// the shared IP, which would starve any other test minting a guest meanwhile.
test("a rate-limited guest mint is retried once on its own and still reaches the Studio", async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(60_000);

  // Fill the window from outside the page (a separate request context, so no
  // cookie reaches the page) until the limiter answers 429. The local server
  // allows E2E_SIGNIN_RATE_MAX per 10 s; a remote one keeps Better-Auth's 3
  // and answers 429 sooner.
  let limited = false;
  for (let i = 0; i < E2E_SIGNIN_RATE_MAX + 5 && !limited; i++) {
    const res = await request.post("/api/auth/sign-in/anonymous", {
      headers: { origin: baseURL ?? "" },
    });
    limited = res.status() === 429;
  }
  expect(limited).toBe(true);

  // The page's own mint is refused too; it keeps the status line up, waits
  // the stated Retry-After and tries again, instead of landing on sign-in.
  const refused = page.waitForResponse(
    (r) => r.url().includes("/sign-in/anonymous") && r.status() === 429
  );
  await page.goto("/design");
  await refused;
  await expect(page.getByTestId("design-entry-status")).toBeVisible();
  await expect(page).not.toHaveURL(/sign-in/);

  await expect(page).toHaveURL(/\/studio$/, { timeout: 20_000 });
  await waitForSessionCookie(page);
});
