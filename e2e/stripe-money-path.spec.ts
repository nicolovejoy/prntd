/**
 * The Stripe test-mode e2e (WP5): real payments through Stripe's checkout, the
 * real signed webhook (Stripe CLI listener forwarding to the local server),
 * and the dry-run Printful submission — asserted all the way to the order row
 * and ledger.
 *
 * Three tests. The cart test pays through Stripe's hosted page (the cart stays
 * hosted). The other two pay through Stripe Embedded Checkout on our own
 * /checkout page, which is how production sells from the image detail page
 * (EMBEDDED_CHECKOUT_ENABLED, with NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY set at
 * build time); both require that switch, and landing on checkout.stripe.com
 * fails the test instead of falling back, so a missing or mismatched
 * publishable key turns the run red. The image-detail-page test orders the
 * owner's own UNPUBLISHED image from the Order panel (one buy surface, slice
 * 3), and the order it creates must carry no Shop composition. The last test
 * does the same purchase but enters through an old /preview link, which
 * redirects to the image detail page with the picks (slice 4).
 *
 * This is the test class that catches real vendor constraints invisible to
 * mocks (e.g. the 2026-07-19 incident: Printful rejects external_id > 32
 * chars, which no mocked or dry-run test could see). Everything between the
 * "Order" click and the ledger rows here runs against the real Stripe API.
 *
 * Deliberately OFF by default — it moves real (test-mode) money and needs a
 * `stripe listen` forwarder on :3100. Run via `npm run e2e:stripe`
 * (docs/stripe-e2e.md); it self-skips everywhere else:
 *   - E2E_STRIPE unset          → plain `npm run e2e` skips it
 *   - E2E_BASE_URL set          → CI-against-preview skips it (Stripe redirect
 *     URLs build from NEXT_PUBLIC_APP_URL, which is prod on previews — the
 *     checkout would bounce off the deployment under test)
 *   - STRIPE_SECRET_KEY not sk_test_ → never pays with a live key
 */
import {
  test,
  expect,
  type Page,
  type Locator,
  type FrameLocator,
} from "@playwright/test";
import {
  userIdForSessionCookie,
  seedDesign,
  cleanupDesigns,
  cleanupOrdersForDesigns,
  cleanupUser,
  orderForStripeSession,
  ledgerTypesForOrder,
  orderItemsForOrder,
  primaryImageIdForDesign,
  storeProductIdForOrder,
} from "./helpers/db";
import { waitForSessionCookie } from "./helpers/session";
import { signUpFreshAccount } from "./helpers/auth";
import { waitForHydrated } from "./helpers/hydration";

const PRODUCT = "bella-canvas-3001";
const TEST_CARD = "4242424242424242";
// Distinct per seeded design so each order line's placement pin is
// independently verifiable (a shared placeholder would make "different
// designs, different pins" untestable).
const IMAGE_A = "https://placehold.co/1024x1024/png?text=A";
const IMAGE_B = "https://placehold.co/1024x1024/png?text=B";

/** Fill the first visible candidate. Stripe owns the checkout DOM and changes
 * it without notice, so every field is resolved through a candidate list. */
async function fillFirstVisible(
  candidates: Locator[],
  value: string
): Promise<boolean> {
  for (const candidate of candidates) {
    const target = candidate.first();
    if (await target.isVisible().catch(() => false)) {
      await target.fill(value);
      return true;
    }
  }
  return false;
}

/** Where Stripe's checkout form lives: the page itself (hosted checkout) or
 * the iframe Stripe mounts on /checkout (embedded checkout). Both expose the
 * locator/getBy* methods the helper below uses. */
type StripeRoot = Page | FrameLocator;

/**
 * Find the iframe holding the embedded checkout form. The selectors were
 * calibrated by the dispatched runs of 2026-10-05 against the live embedded
 * form (frame name/src and field ids differ from hosted checkout's). Returns
 * the first frame whose email field is visible.
 */
async function embeddedStripeRoot(page: Page): Promise<FrameLocator> {
  // `.first()` on each: Stripe.js mounts several js.stripe.com iframes
  // (controller, metrics), and an unqualified FrameLocator that matches more
  // than one frame fails Playwright's strict mode.
  const candidates = [
    page.frameLocator('iframe[name^="embedded-checkout"]').first(),
    page.frameLocator('iframe[src*="embedded-checkout"]').first(),
    page.frameLocator('iframe[src*="js.stripe.com"]').first(),
  ];
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    for (const frame of candidates) {
      const email = frame
        .locator("#email")
        .or(frame.getByRole("textbox", { name: /email/i }));
      if (await email.first().isVisible().catch(() => false)) return frame;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(
    "no Stripe embedded-checkout iframe with an email field within 60s. " +
      "Likely causes: NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is from a different " +
      "Stripe account than STRIPE_SECRET_KEY (the form never mounts), or the " +
      "iframe selectors in embeddedStripeRoot need calibrating."
  );
}

/**
 * Drive Stripe's test checkout, hosted (`root` is the page) or embedded
 * (`root` is the Stripe iframe): email, US shipping address, 4242 test card,
 * Pay. Optional fields (Link prompts, autocomplete) are handled when present
 * and skipped when not.
 */
async function completeStripeCheckout(root: StripeRoot, email: string) {
  // The form is interactable once the email field renders. (The card fields
  // can't be the readiness signal: payment methods are a collapsed accordion
  // and the card inputs don't mount until the Card method is expanded.)
  const emailField = root
    .locator("#email")
    .or(root.getByRole("textbox", { name: /email/i }));
  await expect(emailField.first()).toBeVisible({ timeout: 60_000 });

  const filledEmail = await fillFirstVisible(
    [root.locator("#email"), root.getByRole("textbox", { name: /email/i })],
    email
  );
  expect(filledEmail, "no email field on Stripe checkout").toBe(true);

  // Shipping (shipping_address_collection: US). Stripe may show an address
  // autocomplete first — switch to manual entry when the toggle exists.
  const manualEntry = root.getByText("Enter address manually");
  if (await manualEntry.first().isVisible().catch(() => false)) {
    await manualEntry.first().click();
  }
  await fillFirstVisible(
    [root.locator("#shippingName"), root.getByLabel(/full name/i)],
    "E2E Stripe Buyer"
  );
  await fillFirstVisible(
    [root.locator("#shippingAddressLine1"), root.getByLabel(/address/i)],
    "100 Test Street"
  );
  await fillFirstVisible(
    [root.locator("#shippingLocality"), root.getByLabel(/city/i)],
    "Seattle"
  );
  await fillFirstVisible(
    [root.locator("#shippingPostalCode"), root.getByLabel(/zip/i)],
    "98101"
  );
  const stateSelect = root.locator("select#shippingAdministrativeArea");
  if (await stateSelect.isVisible().catch(() => false)) {
    await stateSelect.selectOption("WA");
  }

  // Card details. Expand the Card accordion first when the inputs aren't
  // already mounted (Stripe lists Card / Cash App / Klarna / … collapsed).
  // Every click is bounded: an unbounded click on this accordion hung until
  // the test timeout once (actionability retried forever on a target that
  // never stabilized).
  //
  // Since 2026-09-30 Stripe renders the "Pay with card" control as a
  // zero-size click overlay on the Card row, so a visibility check skips
  // it. The Card row itself (`card-accordion-item`) is visible and opens the
  // accordion; the overlay button stays as a forced-click fallback.
  const cardNumber = root
    .locator("#cardNumber")
    .or(root.getByPlaceholder("1234 1234 1234 1234"));
  const cardExpanders: { target: Locator; requireVisible: boolean }[] = [
    { target: root.getByTestId("card-accordion-item"), requireVisible: true },
    { target: root.getByRole("radio", { name: /^Card$/ }), requireVisible: true },
    {
      target: root.getByRole("listitem").filter({ hasText: /^Card\b/ }),
      requireVisible: true,
    },
    {
      target: root.getByRole("button", { name: /pay with card/i }),
      requireVisible: false,
    },
  ];
  for (const { target: expander, requireVisible } of cardExpanders) {
    if (await cardNumber.first().isVisible().catch(() => false)) break;
    const target = expander.first();
    if (requireVisible && !(await target.isVisible().catch(() => false))) {
      continue;
    }
    if ((await target.count().catch(() => 0)) === 0) continue;
    const clicked = await target
      .click({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!clicked) {
      // Custom radios are often visually hidden or covered — skip
      // actionability checks as a last resort.
      await target.click({ timeout: 5_000, force: true }).catch(() => {});
    }
  }
  await expect(cardNumber.first()).toBeVisible({ timeout: 30_000 });

  // The 4242 test card never triggers 3DS.
  await cardNumber.first().fill(TEST_CARD);
  await fillFirstVisible(
    [root.locator("#cardExpiry"), root.getByPlaceholder("MM / YY")],
    "12 / 34"
  );
  await fillFirstVisible(
    [root.locator("#cardCvc"), root.getByPlaceholder("CVC")],
    "123"
  );
  await fillFirstVisible(
    [root.locator("#billingName"), root.getByLabel(/name on card/i)],
    "E2E Stripe Buyer"
  );

  // "Save my information" (Link) is checked by default and makes the empty
  // phone-number field required — Pay then fails client-side validation and
  // never navigates. Uncheck it.
  const saveInfo = root.getByRole("checkbox", { name: /save my information/i });
  if (await saveInfo.first().isChecked().catch(() => false)) {
    await saveInfo
      .first()
      .uncheck({ timeout: 5_000 })
      .catch(() =>
        saveInfo.first().click({ timeout: 5_000, force: true }).catch(() => {})
      );
  }

  // /^Pay\b/ would also match the accordion's "Pay with card" / "Pay with
  // Klarna" buttons, which precede the submit button in the DOM.
  const payButton = root
    .getByTestId("hosted-payment-submit-button")
    .or(root.getByRole("button", { name: /^Pay(\s*\$[\d.,]+)?$/ }));
  await payButton.first().click({ timeout: 30_000 });
}

test.describe("stripe money path", { tag: "@stripe" }, () => {
  const stripeKey = process.env.STRIPE_SECRET_KEY ?? "";
  test.skip(
    process.env.E2E_STRIPE !== "1",
    "opt-in only — run via `npm run e2e:stripe`"
  );
  test.skip(
    Boolean(process.env.E2E_BASE_URL),
    "local-only: on previews the Stripe success/cancel URLs point at prod (NEXT_PUBLIC_APP_URL)"
  );
  test.skip(
    !stripeKey.startsWith("sk_test_"),
    "needs a test-mode STRIPE_SECRET_KEY (sk_test_…) in .env.local"
  );

  /** Add a design to the signed-in buyer's cart from its image's image detail
   * page — same UI path a real two-item purchase goes through (not a
   * DB-seeded cart_item row). */
  async function addToCartFromImagePage(page: Page, designId: string) {
    const imageId = await primaryImageIdForDesign(designId);
    expect(imageId, "seeded design has no primary image").toBeTruthy();
    await page.goto(
      `/d/${imageId}?order=1&product=${PRODUCT}&color=Black&size=M`
    );
    // The panel is server-rendered from the link's picks, Total and the button
    // included, so neither proves the page is interactive (see
    // helpers/hydration.ts). Wait for the button itself to hydrate.
    const addToCart = page.getByRole("button", { name: "Add to cart" });
    await expect(page.getByText("Total")).toBeVisible({ timeout: 30_000 });
    await waitForHydrated(addToCart);
    await addToCart.first().click();
    await page.waitForURL(/\/cart/, { timeout: 30_000 });
  }

  test("hosted checkout → signed webhook → submitted order + sale/fee ledger", async ({
    page,
  }, testInfo) => {
    // Stripe page load + payment settle + webhook forward all add up.
    test.setTimeout(300_000);
    const key = `${Date.now()}-${testInfo.project.name}`;
    const seeded: string[] = [];
    let userId = "";

    try {
      // Checkout is the funnel's auth gate, so pay as a fresh real account
      // (a guest would be bounced to sign-in instead of Stripe).
      await signUpFreshAccount(page, key);
      const cookie = await waitForSessionCookie(page);
      userId = await userIdForSessionCookie(cookie);
      // Two DIFFERENT designs, cart-checked-out together — a real prod 2-item
      // order (two designs, two blanks/colors) exposed that multi-item
      // orders were under-covered; this is the strongest signal for it
      // because it runs the real Stripe webhook, not a mock.
      seeded.push(await seedDesign(userId, `${key}-pay-a`, IMAGE_A));
      seeded.push(await seedDesign(userId, `${key}-pay-b`, IMAGE_B));

      await addToCartFromImagePage(page, seeded[0]);
      await expect(page.getByTestId("cart-line-item")).toHaveCount(1, {
        timeout: 30_000,
      });
      await addToCartFromImagePage(page, seeded[1]);
      await expect(page.getByTestId("cart-line-item")).toHaveCount(2, {
        timeout: 30_000,
      });

      await page
        .getByRole("button", { name: /^Checkout/ })
        .click({ timeout: 30_000 });

      await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
      const sessionId = page.url().match(/cs_test_[A-Za-z0-9]+/)?.[0];
      expect(sessionId, `no cs_test_… in checkout URL: ${page.url()}`).toBeTruthy();

      await completeStripeCheckout(page, `e2e-buyer-${key}@prntd.test`);

      // Stripe settles the payment and redirects to success_url.
      await page.waitForURL(/\/order\/confirm/, { timeout: 120_000 });

      // The CLI listener forwards the signed checkout.session.completed to the
      // local webhook: pending → paid (sale + stripe_fee ledger) → dry-run
      // Printful submission → submitted.
      await expect
        .poll(
          async () =>
            (await orderForStripeSession(sessionId!))?.status ?? "missing",
          {
            timeout: 90_000,
            message:
              "order never reached submitted — is `stripe listen` forwarding to :3100 with the secret the server booted with?",
          }
        )
        .toBe("submitted");

      const order = await orderForStripeSession(sessionId!);
      // Dry-run Printful: fake id, no real shirt, costs 0.00 → no COGS row.
      expect(order!.printfulOrderId).toMatch(/^dry-run-/);
      const types = await ledgerTypesForOrder(order!.id);
      expect(types).toContain("sale");
      expect(types).toContain("stripe_fee");
      expect(types).not.toContain("cogs");

      // The multi-item shape itself: one order_item row per cart line, each
      // still pointed at its own design, and each front placement pinned to
      // that design's own image — not the head line's image bleeding across
      // both (the real-world bug this coverage targets).
      const items = await orderItemsForOrder(order!.id);
      expect(items).toHaveLength(2);
      expect(items.map((i) => i.designId).sort()).toEqual([...seeded].sort());

      const expectedPins = new Map<string, string | null>();
      for (const designId of seeded) {
        expectedPins.set(designId, await primaryImageIdForDesign(designId));
      }
      for (const item of items) {
        expect(item.placements?.front).toBeTruthy();
        expect(item.placements?.front).toBe(expectedPins.get(item.designId));
      }
      // The two lines must pin two DIFFERENT images (the whole point of two
      // different designs) — not the same image id twice.
      const pins = items.map((i) => i.placements?.front);
      expect(new Set(pins).size).toBe(2);
    } finally {
      // Orders first (FK to design + user), then designs, then the account.
      await cleanupOrdersForDesigns(seeded);
      await cleanupDesigns(seeded);
      await cleanupUser(userId);
    }
  });

  /**
   * The owner buys their own unpublished image from its image detail page,
   * through embedded checkout, and the order is asserted all the way to the
   * ledger. `enter` gets the page to that image's page with the panel open on
   * the size M / Black shirt (a direct link, or an old /preview link that
   * redirects there); everything after it is shared.
   */
  async function buyFromImagePage(
    page: Page,
    testInfo: { project: { name: string } },
    label: string,
    enter: (ids: { designId: string; imageId: string }) => Promise<void>
  ) {
    test.setTimeout(300_000);
    // Production's setting for purchases from this page. Not optional here:
    // the point of these tests is the path production runs.
    expect(
      process.env.EMBEDDED_CHECKOUT_ENABLED,
      "this test covers the embedded path: set EMBEDDED_CHECKOUT_ENABLED=true (the nightly workflow does)"
    ).toBe("true");
    const key = `${Date.now()}-${testInfo.project.name}`;
    const seeded: string[] = [];
    let userId = "";

    try {
      await signUpFreshAccount(page, key);
      const cookie = await waitForSessionCookie(page);
      userId = await userIdForSessionCookie(cookie);
      seeded.push(await seedDesign(userId, `${key}-${label}`, IMAGE_A));
      const imageId = await primaryImageIdForDesign(seeded[0]);
      expect(imageId, "seeded design has no primary image").toBeTruthy();

      await enter({ designId: seeded[0], imageId: imageId! });

      // The size is picked by the link, so the button carries the total:
      // "Order — $<total>" in the purchase controls and the sticky bar; role
      // queries skip whichever is hidden. The panel is server-rendered from
      // the link's picks, so the button is already enabled before React has
      // attached its handler: wait for hydration, not for Total or enabled.
      const orderButton = page.getByRole("button", { name: /^Order/ });
      await expect(orderButton.first()).toBeEnabled({ timeout: 30_000 });
      await waitForHydrated(orderButton);
      await orderButton.first().click({ timeout: 30_000 });

      // Waiting on either URL and then asserting turns a fail-closed fallback
      // to the hosted page into a red run.
      await page.waitForURL(
        /\/checkout\?session=cs_test_|checkout\.stripe\.com/,
        { timeout: 60_000 }
      );
      expect(
        page.url(),
        "checkout opened on Stripe's hosted page — is EMBEDDED_CHECKOUT_ENABLED on and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY set at build time, from the same Stripe test account as STRIPE_SECRET_KEY?"
      ).toMatch(/\/checkout\?session=cs_test_/);
      const sessionId = page.url().match(/cs_test_[A-Za-z0-9]+/)?.[0];
      expect(sessionId, `no cs_test_… in checkout URL: ${page.url()}`).toBeTruthy();
      await expect(page.getByTestId("checkout-preview")).toBeVisible({
        timeout: 30_000,
      });

      await completeStripeCheckout(
        await embeddedStripeRoot(page),
        `e2e-buyer-${key}@prntd.test`
      );

      await page.waitForURL(/\/order\/confirm/, { timeout: 120_000 });

      await expect
        .poll(
          async () =>
            (await orderForStripeSession(sessionId!))?.status ?? "missing",
          {
            timeout: 90_000,
            message:
              "order never reached submitted — is `stripe listen` forwarding to :3100 with the secret the server booted with?",
          }
        )
        .toBe("submitted");

      const order = await orderForStripeSession(sessionId!);
      expect(order!.printfulOrderId).toMatch(/^dry-run-/);
      const types = await ledgerTypesForOrder(order!.id);
      expect(types).toContain("sale");
      expect(types).toContain("stripe_fee");
      expect(types).not.toContain("cogs");

      // An unpublished image has no Shop composition to record.
      expect(await storeProductIdForOrder(order!.id)).toBeNull();
      const items = await orderItemsForOrder(order!.id);
      expect(items).toHaveLength(1);
      expect(items[0].designId).toBe(seeded[0]);
      expect(items[0].placements?.front).toBe(imageId);
    } finally {
      await cleanupOrdersForDesigns(seeded);
      await cleanupDesigns(seeded);
      await cleanupUser(userId);
    }
  }

  test("image detail page: the owner orders their own unpublished image → embedded checkout → signed webhook → submitted order, no Shop composition", async ({
    page,
  }, testInfo) => {
    await buyFromImagePage(page, testInfo, "detail-buy", async ({ imageId }) => {
      // The link's picks open the panel on the shirt (product, size, colour).
      await page.goto(
        `/d/${imageId}?order=1&product=${PRODUCT}&color=Black&size=M`
      );
    });
  });

  test("an old /preview link → image detail page → embedded checkout → signed webhook → submitted order + sale/fee ledger", async ({
    page,
  }, testInfo) => {
    // Same path as the test above, entered through a /preview link the way a
    // Stripe cancel link or a bookmark from before slice 4 would.
    await buyFromImagePage(
      page,
      testInfo,
      "old-preview-buy",
      async ({ designId, imageId }) => {
        // The old link redirects to the image detail page with the picks.
        await page.goto(
          `/preview?id=${designId}&product=${PRODUCT}&color=Black&size=M`
        );
        await page.waitForURL(
          (url) =>
            url.pathname === `/d/${imageId}` &&
            url.searchParams.get("size") === "M",
          { timeout: 30_000 }
        );
      }
    );
  });
});
