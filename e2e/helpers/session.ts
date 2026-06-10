import { expect, type Page } from "@playwright/test";

/**
 * Wait for the Better-Auth session cookie the guest funnel mints client-side
 * (ensureGuestSession) and return its value.
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
      { timeout: 15_000 }
    )
    .toBe(true);
  return value;
}
