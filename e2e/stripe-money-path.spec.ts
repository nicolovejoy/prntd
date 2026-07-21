/**
 * The one Stripe test-mode e2e (WP5): a real payment through Stripe's hosted
 * checkout, the real signed webhook (Stripe CLI listener forwarding to the
 * local server), and the dry-run Printful submission — asserted all the way
 * to the order row and ledger.
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
import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  userIdForSessionCookie,
  seedDesign,
  cleanupDesigns,
  cleanupOrdersForDesigns,
  cleanupUser,
  orderForStripeSession,
  ledgerTypesForOrder,
} from "./helpers/db";
import { waitForSessionCookie } from "./helpers/session";
import { signUpFreshAccount } from "./helpers/auth";

const PRODUCT = "bella-canvas-3001";
const TEST_CARD = "4242424242424242";

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

/**
 * Drive Stripe's hosted test checkout: email, US shipping address, 4242 test
 * card, Pay. Optional fields (Link prompts, autocomplete) are handled when
 * present and skipped when not.
 */
async function completeStripeCheckout(page: Page, email: string) {
  // The form is interactable once the email field renders. (The card fields
  // can't be the readiness signal: payment methods are a collapsed accordion
  // and the card inputs don't mount until the Card method is expanded.)
  const emailField = page
    .locator("#email")
    .or(page.getByRole("textbox", { name: /email/i }));
  await expect(emailField.first()).toBeVisible({ timeout: 60_000 });

  const filledEmail = await fillFirstVisible(
    [page.locator("#email"), page.getByRole("textbox", { name: /email/i })],
    email
  );
  expect(filledEmail, "no email field on Stripe checkout").toBe(true);

  // Shipping (shipping_address_collection: US). Stripe may show an address
  // autocomplete first — switch to manual entry when the toggle exists.
  const manualEntry = page.getByText("Enter address manually");
  if (await manualEntry.first().isVisible().catch(() => false)) {
    await manualEntry.first().click();
  }
  await fillFirstVisible(
    [page.locator("#shippingName"), page.getByLabel(/full name/i)],
    "E2E Stripe Buyer"
  );
  await fillFirstVisible(
    [page.locator("#shippingAddressLine1"), page.getByLabel(/address/i)],
    "100 Test Street"
  );
  await fillFirstVisible(
    [page.locator("#shippingLocality"), page.getByLabel(/city/i)],
    "Seattle"
  );
  await fillFirstVisible(
    [page.locator("#shippingPostalCode"), page.getByLabel(/zip/i)],
    "98101"
  );
  const stateSelect = page.locator("select#shippingAdministrativeArea");
  if (await stateSelect.isVisible().catch(() => false)) {
    await stateSelect.selectOption("WA");
  }

  // Card details. Expand the Card accordion first when the inputs aren't
  // already mounted (Stripe lists Card / Cash App / Klarna / … collapsed).
  // Every click is bounded: an unbounded click on this accordion hung until
  // the test timeout once (actionability retried forever on a target that
  // never stabilized).
  const cardNumber = page
    .locator("#cardNumber")
    .or(page.getByPlaceholder("1234 1234 1234 1234"));
  const cardExpanders = [
    page.getByRole("radio", { name: /^Card$/ }),
    page.getByRole("listitem").filter({ hasText: /^Card\b/ }),
    page.getByRole("button", { name: /pay with card/i }),
  ];
  for (const expander of cardExpanders) {
    if (await cardNumber.first().isVisible().catch(() => false)) break;
    const target = expander.first();
    if (!(await target.isVisible().catch(() => false))) continue;
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
    [page.locator("#cardExpiry"), page.getByPlaceholder("MM / YY")],
    "12 / 34"
  );
  await fillFirstVisible(
    [page.locator("#cardCvc"), page.getByPlaceholder("CVC")],
    "123"
  );
  await fillFirstVisible(
    [page.locator("#billingName"), page.getByLabel(/name on card/i)],
    "E2E Stripe Buyer"
  );

  // "Save my information" (Link) is checked by default and makes the empty
  // phone-number field required — Pay then fails client-side validation and
  // never navigates. Uncheck it.
  const saveInfo = page.getByRole("checkbox", { name: /save my information/i });
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
  const payButton = page
    .getByTestId("hosted-payment-submit-button")
    .or(page.getByRole("button", { name: /^Pay(\s*\$[\d.,]+)?$/ }));
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
      seeded.push(await seedDesign(userId, `${key}-pay`));

      // URL params pre-select product/color/size; buy is gated on size only.
      await page.goto(
        `/preview?id=${seeded[0]}&product=${PRODUCT}&color=Black&size=M`
      );
      // The CTA label includes the total only once pricing has loaded, so
      // matching on "Order — $" also waits for the page to be fully wired.
      await page
        .getByRole("button", { name: /^Order — \$/ })
        .filter({ visible: true })
        .first()
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
    } finally {
      // Orders first (FK to design + user), then designs, then the account.
      await cleanupOrdersForDesigns(seeded);
      await cleanupDesigns(seeded);
      await cleanupUser(userId);
    }
  });
});
