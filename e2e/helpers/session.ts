import { expect, type Page } from "@playwright/test";

/**
 * Wait for the Better-Auth session cookie the guest funnel mints client-side
 * (ensureGuestSession) and return its value.
 *
 * 20 s: Better-Auth rate-limits sign-ins to 3 per 10 s per IP, and a visitor
 * who hits it is retried once by /design's entry page after the stated wait
 * (about 10 s), so a mint in a busy suite can legitimately land that late.
 */
export async function waitForSessionCookie(page: Page): Promise<string> {
  let value = "";
  await expect
    .poll(
      async () => {
        const cookies = await page.context().cookies();
        const session = cookies.find((c) =>
          c.name.endsWith("better-auth.session_token")
        );
        value = session?.value ?? "";
        return Boolean(session);
      },
      { timeout: 20_000 }
    )
    .toBe(true);
  return value;
}

/**
 * Mint a guest session the way a first-time visitor gets one: load /design,
 * which mints and then replaces itself with the Studio (a document navigation
 * since the fix round of #188 slice 2b), and return the session cookie.
 *
 * It waits for that hop to land before returning. A spec that needs only the
 * cookie and goes straight on to another page.goto would otherwise have its
 * navigation interrupted by the hop's own ("Navigation to … is interrupted by
 * another navigation to /studio").
 */
export async function mintGuestSession(page: Page): Promise<string> {
  await page.goto("/design");
  const cookie = await waitForSessionCookie(page);
  await page.waitForURL(/\/studio/, { timeout: 20_000 });
  return cookie;
}
