import { expect, test } from "@playwright/test";
import { E2E_SIGNIN_RATE_MAX } from "./helpers/rate-limit";
import { waitForSessionCookie } from "./helpers/session";

// Runs in its own Playwright project, alone, after the mobile and desktop
// projects (playwright.config.ts). It fills the sign-in limiter's window for
// the shared IP, which would starve any other test minting a guest meanwhile.
test("a rate-limited guest mint is retried once on its own and still reaches the Studio", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);

  // Fill the sign-in bucket (ip|path; its count resets only after 10 s with no
  // request on it) from outside the page, in a separate request context so no
  // cookie reaches the page, until the limiter answers 429. The local server
  // allows E2E_SIGNIN_RATE_MAX in a row; a remote one keeps Better-Auth's 3
  // and answers 429 sooner.
  //
  // The probe creates no users. The limiter runs in the router's onRequest,
  // before any middleware, so it counts the request; Better-Auth's origin
  // check then refuses it. That check only validates when the request carries
  // a cookie header (validateOrigin in origin-check.mjs), hence the dummy
  // cookie, and the untrusted origin makes it a 403 before the handler. Every
  // answer short of 429 must be that 403; anything else means a guest was
  // minted (or the check changed), so fail instead of carrying on.
  let limited = false;
  for (let i = 0; i < E2E_SIGNIN_RATE_MAX + 5 && !limited; i++) {
    const res = await request.post("/api/auth/sign-in/anonymous", {
      headers: {
        origin: "https://e2e-probe.invalid",
        cookie: "e2e-probe=1",
      },
    });
    limited = res.status() === 429;
    if (!limited) expect(res.status(), `probe ${i}`).toBe(403);
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
