/**
 * Sign-up helper for specs that need a *claimed* (non-anonymous) account —
 * the Stripe money-path spec checks out as a real user, so the guest-only
 * session helper isn't enough.
 *
 * Email/password sign-up has no verification gate (it redirects straight to
 * /designs), so we can mint a real account through the UI. The freshly
 * created user owns whatever the spec seeds (designs) and buys (orders).
 */
import { expect, type Page } from "@playwright/test";

export type FreshAccount = { email: string };

/**
 * Create a brand-new account through /sign-up and wait for the post-sign-up
 * redirect. `key` keeps the email unique per run + project so parallel
 * (mobile + desktop) runs don't collide on the unique email.
 */
export async function signUpFreshAccount(
  page: Page,
  key: string
): Promise<FreshAccount> {
  const email = `e2e-org-${key}@prntd.test`;
  await page.goto("/sign-up");
  await page.getByPlaceholder("Name").fill("E2E Buyer");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: /Sign up/ }).click();
  // Sign-up routes to /designs on success; surface a sign-up error otherwise.
  await expect(
    page,
    "sign-up did not complete (still off /designs)"
  ).toHaveURL(/\/designs/, { timeout: 30_000 });
  return { email };
}
