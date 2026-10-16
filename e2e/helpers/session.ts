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
