/**
 * Guest → account claim: a signed-out visitor gets an anonymous Better-Auth
 * session (#26 Stage A), generates/owns a design under it, then signs up for
 * a real account IN THE SAME BROWSER — the exact path reparentUserData
 * (src/lib/reparent-user.ts) and its integration + schema-coverage tests
 * exercise at the DB layer, but end to end through real sign-up. Confirms
 * the design's ownership actually moves, the anon user row is actually gone
 * (better-auth 1.6 only logs a failed delete, so a stranded anon user would
 * otherwise be invisible here), and the claimed design shows up in the new
 * account's own Studio library.
 */
import { test, expect } from "@playwright/test";
import { waitForSessionCookie } from "./helpers/session";
import { signUpFreshAccount } from "./helpers/auth";
import {
  cleanupDesigns,
  cleanupUser,
  designOwnerId,
  seedDesign,
  userExists,
  userIdForSessionCookie,
} from "./helpers/db";

test("signing up after using the app as a guest claims the guest's design", async ({
  page,
}, testInfo) => {
  const key = `guest-claim-${Date.now()}-${testInfo.project.name}`;
  const seeded: string[] = [];
  let anonUserId = "";
  let claimedUserId = "";

  try {
    // Mint the anonymous session the same way a real first-time visitor
    // would, by loading a funnel page.
    await page.goto("/design");
    const anonCookie = await waitForSessionCookie(page);
    anonUserId = await userIdForSessionCookie(anonCookie);

    // Seed a design owned by that guest (real generation needs Ideogram; seed
    // the row directly, same as every other e2e spec that needs owned
    // artwork).
    const designId = await seedDesign(anonUserId, key);
    seeded.push(designId);

    // Sign up for a real account IN THE SAME PAGE/CONTEXT — no fresh browser,
    // so the anon session cookie is still attached and better-auth's
    // anonymous plugin fires onLinkAccount (reparentUserData) during sign-up.
    await signUpFreshAccount(page, key);

    // The claim mints a brand-new session for the real account; poll until
    // the session cookie resolves to a different user id than the guest's,
    // rather than trusting the first cookie read right after the redirect.
    await expect
      .poll(
        async () => {
          const cookie = await waitForSessionCookie(page);
          claimedUserId = await userIdForSessionCookie(cookie);
          return claimedUserId;
        },
        { timeout: 15_000 }
      )
      .not.toBe(anonUserId);

    // The design's ownership actually moved.
    await expect
      .poll(() => designOwnerId(designId), { timeout: 15_000 })
      .toBe(claimedUserId);

    // The guest user row is actually gone — better-auth 1.6 only logs a
    // failed delete rather than throwing, so a stranded anon user would
    // otherwise pass every UI assertion silently.
    await expect.poll(() => userExists(anonUserId), { timeout: 15_000 }).toBe(
      false
    );

    // The claimed design shows up in the new account's own library, not just
    // in the database.
    await page.goto("/studio/library");
    await expect(page).toHaveURL(/\/studio\/library$/);
    await expect(page.getByTestId("library-tile")).toHaveCount(1);
  } finally {
    await cleanupDesigns(seeded);
    if (claimedUserId) await cleanupUser(claimedUserId);
  }
});
