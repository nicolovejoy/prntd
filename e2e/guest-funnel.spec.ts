/**
 * Guest funnel (#26 Stage A): the design → preview → order surface is open to
 * signed-out visitors, who get an anonymous Better-Auth session; personal
 * record routes stay behind sign-in.
 *
 * #241: the Studio bench and My Designs (/designs, moved out from under the
 * Studio 2026-09-27, revising nav model A) are open to that anonymous session too,
 * with a "Sign up to keep these designs. Have an account? Sign in." line. A
 * visitor with no session at all is still sent to sign-in, and /orders
 * still refuses a guest.
 */
import { test, expect } from "@playwright/test";
import { waitForSessionCookie } from "./helpers/session";
import {
  cleanupDesigns,
  cleanupUser,
  seedDesign,
  seedPublishedImage,
  userIdForSessionCookie,
} from "./helpers/db";

// A fresh guest mint can be refused by Better-Auth's sign-in rate limit (3 per
// 10 s per IP); /design's entry page then waits about 10 s and retries once,
// so the Studio can legitimately take that long to appear.
const STUDIO_AFTER_MINT_MS = 20_000;

test("/design takes a signed-out visitor to the Studio as a guest", async ({
  page,
}) => {
  await page.goto("/design");
  // /design no longer renders a page of its own (#188 slice 2b): it mints the
  // guest session and replaces itself with the Studio bench. The timeout
  // covers one automatic retry after a rate-limited mint (see below).
  await expect(page).toHaveURL(/\/studio$/, { timeout: STUDIO_AFTER_MINT_MS });
  await expect(page).not.toHaveURL(/sign-in/);
  // The empty bench: the composer, and nothing to keep yet (the sign-up line
  // appears with the guest's first lane).
  await expect(
    page.getByRole("textbox", { name: "Describe a design" }).first()
  ).toBeVisible();
  await expect(page.getByTestId("empty-state")).toBeVisible();
});

test("a guest on /design gets an anonymous session", async ({ page }) => {
  await page.goto("/design");
  await waitForSessionCookie(page);
  await expect(page).toHaveURL(/\/studio$/, { timeout: STUDIO_AFTER_MINT_MS });
});

test("a rate-limited guest mint is retried once on its own and still reaches the Studio", async ({
  page,
  request,
  baseURL,
}, testInfo) => {
  // One browser project is enough: the limiter is per IP, not per viewport.
  test.skip(testInfo.project.name !== "mobile", "viewport-independent");
  test.setTimeout(60_000);

  // Better-Auth allows 3 sign-ins per 10 s per IP. Fill the window from
  // outside the page (a separate request context, so no cookie reaches the
  // page) until the limiter answers 429.
  let limited = false;
  for (let i = 0; i < 6 && !limited; i++) {
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

  await expect(page).toHaveURL(/\/studio$/, { timeout: STUDIO_AFTER_MINT_MS });
  await waitForSessionCookie(page);
});

test("personal routes still redirect a visitor with no session to sign-in", async ({
  page,
}) => {
  await page.goto("/designs");
  await expect(page).toHaveURL(/sign-in/);
  await page.goto("/orders");
  await expect(page).toHaveURL(/sign-in/);
});

test("a guest with an anonymous session reaches their own Studio, not /orders", async ({
  page,
}, testInfo) => {
  const key = `guest-studio-${Date.now()}-${testInfo.project.name}`;
  const seeded: string[] = [];

  try {
    await page.goto("/design");
    const cookie = await waitForSessionCookie(page);
    const userId = await userIdForSessionCookie(cookie);
    const designId = await seedDesign(userId, key);
    seeded.push(designId);

    // Bench: the guest's own lane, plus the sign-up/sign-in line.
    await page.goto("/studio");
    await expect(page).toHaveURL(/\/studio$/);
    await expect(page.getByTestId("guest-keep-line")).toBeVisible();
    await expect(page.getByTestId("guest-sign-up")).toHaveAttribute(
      "href",
      "/sign-up"
    );
    await expect(page.getByTestId("guest-sign-in")).toHaveAttribute(
      "href",
      "/sign-in"
    );
    await expect(page.getByTestId("studio-lane")).toHaveCount(1);

    // My Designs: the guest's own image, plus the same line.
    await page.goto("/designs");
    await expect(page).toHaveURL(/\/designs$/);
    await expect(page.getByTestId("guest-keep-line")).toBeVisible();
    // My Designs' line carries next, so sign-up/sign-in return here.
    await expect(page.getByTestId("guest-sign-up")).toHaveAttribute(
      "href",
      "/sign-up?next=%2Fdesigns"
    );
    await expect(page.getByTestId("guest-sign-in")).toHaveAttribute(
      "href",
      "/sign-in?next=%2Fdesigns"
    );
    await expect(page.getByTestId("library-tile")).toHaveCount(1);

    // The old /studio/library address still 308s here, carrying the query.
    await page.goto("/studio/library?from=x");
    await expect(page).toHaveURL(/\/designs\?from=x$/);

    // Orders stay real-account-only.
    await page.goto("/orders");
    await expect(page).toHaveURL(/sign-in/);
  } finally {
    await cleanupDesigns(seeded);
  }
});

test("a guest's size and colour on the image detail page survive Sign in to buy and sign-up (#278)", async ({
  page,
}, testInfo) => {
  const key = `guest-buy-picks-${Date.now()}-${testInfo.project.name}`;
  let seededDesign = "";
  let sellerId = "";
  let anonUserId = "";
  let claimedUserId = "";

  try {
    const seeded = await seedPublishedImage(key, `Buy picks ${key}`);
    seededDesign = seeded.designId;
    sellerId = seeded.sellerId;
    const imagePath = `/d/${seeded.imageId}`;

    // A guest session, minted the way a first-time visitor gets one.
    await page.goto("/design");
    anonUserId = await userIdForSessionCookie(await waitForSessionCookie(page));

    await page.goto(imagePath);
    await page.getByTestId("order-expand").click();
    await page.getByRole("button", { name: "L", exact: true }).click();
    // A colour that is not the default (White), so the check below can tell
    // the link's pick from the default.
    await page.getByTitle("Black", { exact: true }).click();
    await expect(page).toHaveURL(/[?&]size=L(&|$)/);
    await expect(page).toHaveURL(/[?&]color=Black(&|$)/);

    // Sign in to buy -> sign-in page -> its Sign up link, which carries next.
    await page.getByRole("link", { name: "Sign in to buy" }).click();
    await expect(page).toHaveURL(/\/sign-in\?next=/);
    await page.getByRole("link", { name: "Sign up", exact: true }).click();
    await expect(page).toHaveURL(/\/sign-up\?next=/);
    await page.getByPlaceholder("Name").fill("E2E Buyer");
    await page.getByPlaceholder("Email").fill(`e2e-buyer-${key}@prntd.test`);
    await page.getByPlaceholder("Password").fill("e2e-password-123");
    await page.getByRole("button", { name: /Sign up/ }).click();

    // Read the new account's id as soon as it exists, before any assertion
    // that could fail, so the cleanup below always knows it (the claim mints
    // a new session for a different user than the guest's). Mid-claim the
    // browser can still hold the guest's cookie after its session row is
    // deleted, so a missing row means "not yet", not a failure.
    await expect
      .poll(
        async () => {
          const cookie = await waitForSessionCookie(page);
          try {
            claimedUserId = await userIdForSessionCookie(cookie);
          } catch {
            return anonUserId;
          }
          return claimedUserId;
        },
        { timeout: 30_000 }
      )
      .not.toBe(anonUserId);

    // Back on the same image, panel open, size and colour kept.
    await expect(
      page,
      "sign-up did not return to the image detail page"
    ).toHaveURL(new RegExp(`${imagePath}\\?`), { timeout: 30_000 });
    await expect(page.getByTestId("order-expand")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "L", exact: true })
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Color \u2014 Black")).toBeVisible();
    // Signed in now: one tap on Order is available (not tapped here; the
    // Stripe specs cover checkout).
    await expect(
      page.getByRole("button", { name: /^Order \u2014 \$\d/ })
    ).toBeEnabled();
  } finally {
    // Designs first (the mirror product FKs the seller), then every account
    // the run made. The guest row is normally already gone after a claim;
    // cleanupUser on a missing row deletes nothing.
    if (seededDesign) await cleanupDesigns([seededDesign]);
    if (sellerId) await cleanupUser(sellerId);
    if (claimedUserId) await cleanupUser(claimedUserId);
    if (anonUserId) await cleanupUser(anonUserId);
  }
});
