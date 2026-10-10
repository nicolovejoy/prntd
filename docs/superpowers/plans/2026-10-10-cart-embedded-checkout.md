# Cart on Embedded Checkout Implementation Plan (#278 slice 6b, #135 slice 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The cart's Checkout button opens Stripe Embedded Checkout on our own `/checkout` page, behind the existing `EMBEDDED_CHECKOUT_ENABLED` switch, with hosted checkout as the fail-closed fallback.

**Architecture:** `buildCartCheckoutSessionParams` gains the `uiMode` parameter the single-item builder already has. `checkoutCart` resolves the embedded config before it writes the order, passes `uiMode` and a return origin to the builder, and returns either Stripe's hosted URL or our own `/checkout?session=…&from=%2Fcart` path. `/checkout`, its loader, `/order/confirm` and the webhook already handle an order with several lines; this slice adds the missing multi-line tests and fixes the one part that is single-line (the laptop layout of the review block). The two order-creation paths (`checkoutCart`, `createStripeCheckoutForOrder`) stay separate. No schema change.

**Tech Stack:** Next.js 16 App Router, server actions, Stripe Checkout (`stripe` 20.x, `@stripe/react-stripe-js` 5.x), Drizzle + libSQL, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-10-cart-embedded-checkout.md`. Read it first: it holds Nico's nine decisions (2026-10-10), Claude's rulings with their cost, and the rollout and rollback. Issues: #278 (one buy surface, slice 6b), #135 (slice 4).

Written against main at `8bf8160`. Every line number below is from that commit. Re-read the file before editing; if main has moved, trust the code.

## Global Constraints

Hand this section to every implementer and every reviewer as it stands.

- **No new switch, no new env var.** The cart reads `EMBEDDED_CHECKOUT_ENABLED` only through `embeddedCheckoutConfig()` and `embeddedCheckoutFlag()`. Merging makes the change live in Production at once, because that switch is on there. Turning the switch off turns embedded checkout off for the image detail page too.
- **Fail closed to hosted.** Switch on with a missing, malformed or mode-mismatched publishable key: hosted checkout plus one `console.error` naming the reason. The log line never contains a key.
- **Switch off is today's behaviour, key for key.** The hosted Stripe params, the hosted URL and the rows written must not change.
- **The two order-creation paths stay separate.** Do not route the cart through `createStripeCheckoutForOrder`, and do not change `src/lib/order-checkout.ts`, `src/app/d/actions.ts`, `src/app/order/**`, `src/lib/webhook-handlers.ts` or `src/app/api/webhooks/**`.
- **Nothing new between the insert and the Stripe call.** In `checkoutCart` the order and its lines are written, then Stripe is called, and a throw from Stripe marks the order abandoned. Any new read (config, headers) happens before the `db.batch`.
- **No migration.** `npm run db:generate` must print "No schema changes". If a schema change appears, stop and report.
- **No new user-facing string.** The thrown-action notice reuses `CHECKOUT_FAILED` from `src/lib/action-copy.ts`. If a task seems to need new copy (a label, an `aria-label`, a notice), stop and add it to "Open questions for Nico" instead of writing it.
- **No price in this plan, in a brief, or in a fixture this slice adds.** New test fixtures take prices from `computePrice(...)` or from an existing fixture object; assertions match by pattern (`$` absent), never by value. `/checkout`'s review block shows no price: Stripe's form is the only place one appears there. Guards: `src/lib/__tests__/no-preselection-price.test.ts` and the no-`$` assertions in `src/app/checkout/__tests__/page.test.tsx`.
- **`"use server"` files export async functions only.** `src/app/cart/actions.ts` gains no export. Non-exported constants and helpers are fine.
- **Lint.** `@typescript-eslint/no-explicit-any` is an error outside tests. `catch (err)` and narrow with `err instanceof Error ? err.message : String(err)`; a bare `catch {` is fine when the error is not used.
- **This is not the Next.js in your training data** (`AGENTS.md`). Before writing code, read the guide for what you touch under `node_modules/next/dist/docs/`: `01-app/03-api-reference/04-functions/headers.md` (Task 2), `01-app/01-getting-started/07-mutating-data.md` (Tasks 2 and 3), `01-app/03-api-reference/03-file-conventions/page.md` (Task 4).
- **Tests.** Real-DB integration tests use `createTestDb()` (`src/lib/__tests__/test-db.ts`) and the factories in `src/lib/__tests__/factories.ts`. `src/lib/**` tests run under node, `src/app/**` under jsdom. Vitest does not load `.env.local`; tests set env with `vi.stubEnv` and clear it with `vi.unstubAllEnvs()`. Never read a `.env*` file.
- **Money path.** This changes how a cart is paid for. It gets real-DB tests (Task 2) and a dedicated adversarial review (Task 7). Re-run tests yourself; do not rely on an implementer's report.
- **Phone-first.** 44px touch targets and no horizontal scroll at 390px. Nothing here changes a phone layout.
- **Words.** Say "image detail page", not "/d", in comments, commit messages, PR text and messages to Nico. Comments say what the code does and why, plainly.
- **Shell.** Work only in the worktree for branch `claude/cart-embedded-checkout`. When the shell's working directory is not the worktree, use absolute paths and `git -C <worktree>`. Do not build slice 6a (removing `/preview` checkout code and `PREVIEW_EMBEDDED_CHECKOUT_ENABLED`) on this branch.
- **Commits.** One commit per task. End each message with the attribution trailer lines the executing session's own instructions give; do not copy a trailer from another plan.
- **Gate before the PR:** `npm run lint && npm run typecheck && npm test && npm run build` (build env: the dummy block in `ci.yml`'s `check` job), `npm run db:generate` printing "No schema changes", then `npm run e2e`.
- **Reviews.** Never tell a reviewer what not to flag. State the rulings and let them flag anything. A review another agent must act on is posted on the PR as a comment.
- **Nico merges.** The PR title starts with `HOLD:` until the three gates in Task 8 have passed on the PR's final commit.

## Review Focus

Conditions the spec implies but no feature sentence names, most likely to bite first. Each is pinned to a task.

1. **A second Checkout while an earlier session is still open** (Back from `/checkout` then Checkout again, a double tap, two tabs). Expected: a second order and session; the first stays pending and payable until it expires. This is the known behaviour (decision 7), not a regression, and the follow-up issue covers it. Pinned in Task 2 so nobody "fixes" it by accident or breaks it unnoticed.
2. **The switch is on but the key pair in the deployment is wrong** (missing, malformed, the other mode). Expected: hosted checkout, one log line naming the reason and the cart, no key in the log, and never an embedded session that cannot mount. Pinned in Task 2.
3. **`checkoutCart` throws** (Stripe unavailable, a database error, a lost response). Expected: the order written before the Stripe call is marked abandoned, the cart is intact, and the cart page shows the existing checkout-failed line with the button usable again. A structured refusal keeps its own message. Pinned in Task 2 (server) and Task 3 (page).
4. **A cart with several lines, a quantity above one and a back design, opened on `/checkout`.** Expected: one review row per line with that line's own artwork, colour, size and quantity (no image or mockup from another line), no price, the Back link to the cart. Pinned in Task 4.
5. **The request's `Origin` is a Preview host, or something untrusted.** Expected: an embedded session's `return_url` follows a trusted Preview origin and otherwise falls back to `NEXT_PUBLIC_APP_URL`; hosted checkout ignores the origin. Pinned in Task 2.

## Survey corrections

The read-only survey made for this slice (a session scratch file, not in the repo) was checked against the code. Claims that are wrong or incomplete:

- `handleCheckout` is at `src/app/cart/page.tsx:113-132`, not `:105-123` (those lines are the end of `handleQuantity`).
- "`/checkout` is already multi-line" holds for the data path only. The layout is single-line: `src/app/checkout/checkout-line.tsx:61` and `:64` switch each line to a full-width square from `md` up, and `src/app/checkout/__tests__/page.test.tsx:260-262` pins that class. The line's button names (`checkout-line.tsx:70`, `:97`) are not unique per line either.
- `handleStripeCheckoutCompleted` is `src/lib/webhook-handlers.ts:85-211`; `:145-181` is only its claim batch. `cartLineMatch` is `src/lib/cart-line-match.ts:31-41`.
- The test list omits three callers of `checkoutCart` that assert a hosted URL with the switch unset (`add-to-cart-front-pin`, `add-to-cart-own-unpublished` and `add-to-cart-swap` under `src/app/cart/__tests__/`) and one that calls it without asserting a URL (`src/app/d/__tests__/render-pin-source.integration.test.ts`).
- `docs/stripe-e2e.md` is stale in one more place: it says the run makes two payments; it makes three.

Confirmed: the parent plan's Slice 6 bullet (`docs/superpowers/plans/2026-10-01-one-buy-surface.md:984`) is wrong on two counts. The cart does not go through `createStripeCheckoutForOrder`, and by Nico's decision it gets no switch of its own.

## Fence

Files this slice may touch.

Product code:

- `src/lib/checkout.ts` — `buildCartCheckoutSessionParams` (Task 1).
- `src/app/cart/actions.ts` — `checkoutCart` and two comments (Task 2).
- `src/lib/flags.ts`, `src/lib/embedded-checkout.ts` — comments only (Task 2).
- `src/app/cart/page.tsx` — `handleCheckout` (Task 3).
- `src/app/checkout/checkout-line.tsx`, `src/app/checkout/page.tsx` — the `compact` prop, a test id, a docblock (Task 4).

Tests:

- `src/lib/__tests__/checkout.test.ts` (Task 1)
- `src/app/cart/__tests__/checkout-cart-embedded.integration.test.ts`, new (Task 2)
- `src/app/cart/__tests__/cart-page.test.tsx` (Task 3)
- `src/lib/__tests__/embedded-checkout-session.integration.test.ts`, `src/app/checkout/__tests__/page.test.tsx`, `src/app/checkout/__tests__/checkout-line.test.tsx` (Task 4)
- `e2e/stripe-money-path.spec.ts` (Task 5)

Docs and config comments (Task 5): `docs/stripe-e2e.md`, `.github/workflows/stripe-e2e.yml` (comments only), `CLAUDE.md` (three standing lines), `docs/superpowers/plans/2026-10-01-one-buy-surface.md` (one note), and the ledger `docs/superpowers/ledgers/2026-10-10-cart-embedded-checkout.md` (Task 9).

Must not change: `src/lib/order-checkout.ts`, `src/app/d/**`, `src/app/order/**`, `src/lib/embedded-checkout-session.ts`, `src/lib/checkout-session-status.ts`, `src/lib/webhook-handlers.ts`, `src/app/api/**`, `src/lib/db/schema.ts`, `drizzle/**`, `.github/workflows/ci.yml`, `playwright.config.ts`.

Consumers of what this slice changes:

- `buildCartCheckoutSessionParams`: one caller, `checkoutCart` (`src/app/cart/actions.ts:645`), and `checkout.test.ts`.
- `checkoutCart`'s returned `url`: one UI caller, `handleCheckout` in `src/app/cart/page.tsx`. Tests that call it and assert a hosted URL with the switch unset, all under `src/app/cart/__tests__/`: `add-to-cart-front-pin`, `add-to-cart-own-unpublished`, `add-to-cart-swap`, `checkout-cart-attribution`, `checkout-revalidates-lines`, `checkout-stripe-failure` and `update-cart-item` (`webhook-cart-cleanup-placements` stubs the switch off itself). They keep passing because Vitest sees the switch unset; do not add the switch to the `check` job in `ci.yml`.
- The embedded Stripe session: `loadEmbeddedCheckout` (reads `ui_mode`, `client_secret`), `/order/confirm` (`getCheckoutSessionState`), the Stripe webhook (`toStripeSessionData`, `metadata.orderId`). None of them changes.
- The `/checkout?…&from=%2Fcart` URL: `safeCheckoutReturnPath`, the page's Back links, the sign-in round trip (`embeddedCheckoutPath`).
- `CheckoutLine`: one caller, `ReviewBlock` in `src/app/checkout/page.tsx:181`.
- `data-testid="checkout-preview"`: `page.test.tsx`, `checkout-line.test.tsx`, `e2e/stripe-money-path.spec.ts:431` and `:452-455`. With two lines the id matches twice, so every use is counted or scoped (Tasks 4 and 5).

## Interfaces produced by this slice

```ts
// src/lib/checkout.ts — one new optional parameter, same return type
export function buildCartCheckoutSessionParams(params: {
  orderId: string;
  designId: string;
  lineItems: { name: string; description: string; imageUrl: string | null; unitPrice: number; quantity: number }[];
  shippingPrice: number;
  cancelUrl: string;                  // ignored when uiMode is "embedded"
  appUrl: string;                     // hosted: NEXT_PUBLIC_APP_URL; embedded: the return origin
  now?: number;
  uiMode?: "hosted" | "embedded";     // NEW, default "hosted"
}): Stripe.Checkout.SessionCreateParams;

// src/app/cart/actions.ts — signature unchanged
export async function checkoutCart(): Promise<{
  url: string | null;   // hosted: https://checkout.stripe.com/…  embedded: /checkout?session=<id>&from=%2Fcart
  needsAuth?: boolean;
  error?: string;
}>;
// Throws when the Stripe call (or anything before it) throws.

// src/app/checkout/checkout-line.tsx — one new optional prop
export function CheckoutLine(props: { line: CheckoutLineSummary; compact?: boolean }): JSX.Element;

// src/app/checkout/page.tsx — the review block's wrapper
// <div data-testid="checkout-review"> … one CheckoutLine per summary entry … </div>
```

## Preflight: what each task produces and the next consumes

No two implementer tasks edit the same file. The dependencies are interfaces.

| Producer | Consumer | What is produced | What the consumer relies on |
|---|---|---|---|
| Task 1 | Task 2 | `buildCartCheckoutSessionParams({ …, uiMode })` | Passing `uiMode: "embedded"` yields `ui_mode: "embedded"` and `return_url` built from `appUrl`; omitting it yields today's hosted object. Task 2's tests rebuild the expected hosted params with this builder. |
| Task 2 | Task 3 | `checkoutCart()` returns a relative `/checkout?session=…&from=%2Fcart` in embedded mode, and still throws on failure | The page assigns `url` to `window.location.href` unchanged and catches a throw. Task 3 mocks the action; it does not need Task 2's code, only this contract. |
| Task 2 | Task 4 | Orders with N `order_item` rows reach `/checkout` with `from=/cart` | The loader and page are given such an order and URL. Task 4 seeds its own rows; it does not call `checkoutCart`. |
| Task 4 | Task 5 | `data-testid="checkout-review"` wrapping one `checkout-preview` per line; "← Back" pointing at `from` | The nightly counts `checkout-preview` inside `checkout-review` and reads the Back link's `href`. |
| Task 2 | Task 5 | The cart's Checkout lands on `/checkout?session=cs_test_…&from=%2Fcart` when the switch is on | The nightly waits for that URL and fails if it sees `checkout.stripe.com`. |
| Tasks 1–5 | Task 6 | The finished branch | Gate, whole-branch review, PR. |
| Task 6 | Tasks 7, 8 | An open PR titled `HOLD:` and a pushed branch | The adversarial review comments on the PR; the workflow is dispatched on the branch; the Preview builds from the push. |
| Task 7 | Task 8 | The final commit, after any fix round | The dispatched run and the smoke are both taken on that commit. |

## Before Task 1

- [ ] In the worktree: `npm ci` (it has no `node_modules`).
- [ ] `git status` is clean and the branch is `claude/cart-embedded-checkout`.
- [ ] `git fetch origin && git log --oneline HEAD..origin/main`. If main has moved, merge it and re-read every file this plan names before editing.
- [ ] Slice 6a is not in flight: `gh pr list --search "PREVIEW_EMBEDDED_CHECKOUT_ENABLED in:title,body"` and `git branch -a | grep -i -E "remove-preview|6a"` show nothing open. If 6a is open, stop and ask: the two slices are built one after the other (spec, "Slice 6a").
- [ ] `npx vitest run src/lib/__tests__/checkout.test.ts src/app/cart src/app/checkout src/lib/__tests__/embedded-checkout-session.integration.test.ts` passes before any change.

---

### Task 1: The cart session builder gets an embedded mode

**Files:**
- Modify: `src/lib/checkout.ts:114-175` (`buildCartCheckoutSessionParams` and its docblock)
- Test: `src/lib/__tests__/checkout.test.ts` (append inside `describe("buildCartCheckoutSessionParams", …)`, which starts at `:193`)

**Interfaces:**
- Consumes: nothing.
- Produces: `uiMode?: "hosted" | "embedded"` on `buildCartCheckoutSessionParams`, as under "Interfaces produced by this slice".

- [ ] **Step 1: Write the tests**

Append these four cases to the existing `describe("buildCartCheckoutSessionParams", …)` block. They use the file's existing `cartBase` fixture; do not add a new fixture and do not write an amount.

```ts
  it("with no uiMode deep-equals the hosted shape (pins the cart's hosted params key for key)", () => {
    const now = 1_700_000_000_000;
    const cents = (n: number) => Math.round(n * 100);
    const p = buildCartCheckoutSessionParams({ ...cartBase, now });
    expect(p).toEqual({
      mode: "payment",
      allow_promotion_codes: true,
      expires_at: Math.floor(now / 1000) + CHECKOUT_SESSION_TTL_SECONDS,
      shipping_address_collection: { allowed_countries: ["US"] },
      line_items: cartBase.lineItems.map((li) => ({
        price_data: {
          currency: "usd",
          product_data: {
            name: `PRNTD ${li.name}`,
            description: li.description,
            images: li.imageUrl ? [li.imageUrl] : [],
          },
          unit_amount: cents(li.unitPrice),
        },
        quantity: li.quantity,
      })),
      shipping_options: [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: cents(cartBase.shippingPrice), currency: "usd" },
            display_name: "Standard shipping",
          },
        },
      ],
      metadata: { orderId: cartBase.orderId, designId: cartBase.designId },
      success_url: `${cartBase.appUrl}/order/confirm?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cartBase.cancelUrl,
    });
  });

  it("uiMode: 'hosted' produces the identical shape as omitting uiMode", () => {
    const now = 1_700_000_000_000;
    expect(
      buildCartCheckoutSessionParams({ ...cartBase, now, uiMode: "hosted" })
    ).toEqual(buildCartCheckoutSessionParams({ ...cartBase, now }));
  });

  it("uiMode: 'embedded' sets ui_mode + return_url, omits success_url/cancel_url, and otherwise matches hosted", () => {
    const now = 1_700_000_000_000;
    const hosted = buildCartCheckoutSessionParams({ ...cartBase, now });
    const embedded = buildCartCheckoutSessionParams({
      ...cartBase,
      now,
      uiMode: "embedded",
    });

    expect(embedded).toEqual({
      ...hosted,
      ui_mode: "embedded",
      return_url: `${cartBase.appUrl}/order/confirm?session_id={CHECKOUT_SESSION_ID}`,
      success_url: undefined,
      cancel_url: undefined,
    });
    expect(embedded).not.toHaveProperty("success_url");
    expect(embedded).not.toHaveProperty("cancel_url");
    // Still one Stripe line per cart line and one shipping option.
    expect(embedded.line_items).toHaveLength(cartBase.lineItems.length);
    expect(embedded.shipping_options).toHaveLength(1);
  });

  it("embedded: return_url is built from the appUrl it is given, so a Preview origin stays on the Preview", () => {
    const origin = "https://prntd-git-x-nico-lovejoys-projects.vercel.app";
    const p = buildCartCheckoutSessionParams({
      ...cartBase,
      appUrl: origin,
      uiMode: "embedded",
    });
    expect(p.return_url).toBe(
      `${origin}/order/confirm?session_id={CHECKOUT_SESSION_ID}`
    );
  });
```

- [ ] **Step 2: Run them and watch the embedded cases fail**

Run: `npx vitest run src/lib/__tests__/checkout.test.ts`
Expected: the first two new cases PASS (they pin what must not change; the builder ignores an unknown `uiMode` today). The two `embedded` cases FAIL: `ui_mode` and `return_url` are missing and `success_url` is present.

- [ ] **Step 3: Add `uiMode` to the builder**

In `src/lib/checkout.ts`, add the parameter after `now?: number;` in `buildCartCheckoutSessionParams`'s parameter type:

```ts
  /**
   * Hosted (default) or embedded, exactly as in `buildCheckoutSessionParams`
   * above: an embedded session takes `return_url` in place of
   * `success_url`/`cancel_url`, and `cancelUrl` is ignored (the way back is
   * `/checkout`'s own Back link, which `checkoutCart` points at the cart).
   */
  uiMode?: "hosted" | "embedded";
```

Change the body so the last two keys depend on the mode. The rest of the object is unchanged:

```ts
}): Stripe.Checkout.SessionCreateParams {
  const embedded = params.uiMode === "embedded";
  return {
    mode: "payment",
    allow_promotion_codes: true,
    expires_at:
      Math.floor((params.now ?? Date.now()) / 1000) +
      CHECKOUT_SESSION_TTL_SECONDS,
    shipping_address_collection: { allowed_countries: ["US"] },
    line_items: params.lineItems.map((li) => ({
      price_data: {
        currency: "usd",
        product_data: {
          name: `PRNTD ${li.name}`,
          description: li.description,
          images: li.imageUrl ? [li.imageUrl] : [],
        },
        unit_amount: Math.round(li.unitPrice * 100),
      },
      quantity: li.quantity,
    })),
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: {
            amount: Math.round(params.shippingPrice * 100),
            currency: "usd",
          },
          display_name: "Standard shipping",
        },
      },
    ],
    metadata: { orderId: params.orderId, designId: params.designId },
    ...(embedded
      ? {
          ui_mode: "embedded" as const,
          return_url: `${params.appUrl}/order/confirm?session_id={CHECKOUT_SESSION_ID}`,
        }
      : {
          success_url: `${params.appUrl}/order/confirm?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: params.cancelUrl,
        }),
  };
}
```

In the docblock above the function (`:114-120`), append one sentence: `Like the single-item builder it takes a \`uiMode\`: the cart mounts on our own /checkout page when embedded checkout is enabled (#278 slice 6b).`

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/lib/__tests__/checkout.test.ts && npm run typecheck`
Expected: PASS, clean. (`checkoutCart` does not pass `uiMode` yet; it is optional.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/checkout.ts src/lib/__tests__/checkout.test.ts
git commit -m "Cart session builder: embedded mode (#278 slice 6b)"
```

---

### Task 2: `checkoutCart` creates an embedded session behind the existing switch

**Files:**
- Modify: `src/app/cart/actions.ts` — imports (`:1-46`), the comment at `:48-51`, the docblock at `:520-533`, and `checkoutCart` (`:534-678`)
- Modify (comments only): `src/lib/flags.ts:29-41`, `src/lib/embedded-checkout.ts:7-9`, `:60-63`, `:121-125`
- Create: `src/app/cart/__tests__/checkout-cart-embedded.integration.test.ts`

**Interfaces:**
- Consumes: `buildCartCheckoutSessionParams({ …, uiMode })` from Task 1. From `src/lib/embedded-checkout.ts`, unchanged: `embeddedCheckoutConfig(): EmbeddedCheckoutResolution`, `embeddedCheckoutPath(sessionId: string, backPath: string): string`, `resolveReturnOrigin(originHeader: string | null, appUrl: string | undefined): string`. From `src/lib/flags.ts`, unchanged: `embeddedCheckoutFlag(): boolean`.
- Produces: `checkoutCart()` returning `/checkout?session=<id>&from=%2Fcart` in embedded mode; signature unchanged.

The model for this task is `buyPublishedDesign` in `src/app/d/actions.ts:705-747` and its test `src/app/d/__tests__/buy-published-design-embedded.integration.test.ts`. Read both first.

- [ ] **Step 1: Write the integration tests**

Create `src/app/cart/__tests__/checkout-cart-embedded.integration.test.ts`:

```ts
/**
 * checkoutCart on Stripe Embedded Checkout (#278 slice 6b) against a real
 * in-memory libSQL. The cart rides the image detail page's switch
 * (EMBEDDED_CHECKOUT_ENABLED): off is the hosted session it has always built;
 * on with a usable key pair is an embedded session and a /checkout URL whose
 * Back is the cart; on with a bad key pair is hosted plus one console.error
 * naming the reason. Also pinned: the order and every line are written before
 * Stripe is called in both modes, the Origin rules for return_url, the
 * Stripe-failure path, and the known behaviour that each Checkout makes its
 * own order and session.
 *
 * The db singleton, auth session, request headers, Printful quote and Stripe
 * client are mocked; the database is real (FKs enforced, schema-derived).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type Stripe from "stripe";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import {
  makeUser,
  makeDesign,
  makeSourceImage,
  setPublication,
} from "@/lib/__tests__/factories";
import { buildCartCheckoutSessionParams } from "@/lib/checkout";
import { embeddedCheckoutPath } from "@/lib/embedded-checkout";
import { getBlank } from "@/lib/blanks";
import { CART_LINE_UNAVAILABLE } from "@/lib/action-copy";

type OrderRow = typeof schema.order.$inferSelect;
type OrderItemRow = typeof schema.orderItem.$inferSelect;

const h = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
  sessionParams: [] as Stripe.Checkout.SessionCreateParams[],
  /** The order and order_item rows as they were when Stripe was called. */
  rowsAtCreateTime: [] as { orders: OrderRow[]; items: OrderItemRow[] }[],
  /** Simulated `Origin` request header, read by resolveReturnOrigin. */
  originHeader: null as string | null,
  stripeError: null as Error | null,
  /** What the Stripe mock returns as `url` for a hosted session. */
  hostedUrl: "https://checkout.stripe.example/cs_test_hosted",
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => h.session } },
  isAnonymousUser: (u: { isAnonymous?: boolean } | undefined) =>
    Boolean(u?.isAnonymous),
}));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(h.originHeader ? { origin: h.originHeader } : {}),
}));

// The shipping quote falls back to the flat estimate.
vi.mock("@/lib/printful", () => ({
  estimateOrderCosts: vi.fn(async () => null),
}));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(async (params: Stripe.Checkout.SessionCreateParams) => {
          if (h.stripeError) throw h.stripeError;
          h.sessionParams.push(params);
          const db = h.db as Awaited<ReturnType<typeof createTestDb>>;
          h.rowsAtCreateTime.push({
            orders: await db.select().from(schema.order),
            items: await db.select().from(schema.orderItem),
          });
          const embedded =
            (params as { ui_mode?: string }).ui_mode === "embedded";
          return {
            id: `cs_test_${h.sessionParams.length}`,
            // Stripe returns no url for an embedded session.
            url: embedded ? null : h.hostedUrl,
          };
        }),
      },
    },
  },
}));

import {
  addToCart,
  setCartItemQuantity,
  checkoutCart,
} from "@/app/cart/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const PRODUCT = "bella-canvas-3001";
const APP_URL = "http://localhost:3000";
const PREVIEW_ORIGIN =
  "https://prntd-git-feature-x-nico-lovejoys-projects.vercel.app";
const HOSTED_URL = h.hostedUrl;
const LISTING_URL = "https://img.example/listing.png";
const MINE_URL = "https://img.example/mine.png";
const BUYER = { user: { id: "buyer", isAnonymous: false } };
const CONFIRM_PATH = "/order/confirm?session_id={CHECKOUT_SESSION_ID}";

/**
 * A two-line cart for "buyer". Line 1: a seller's published image with the
 * buyer's own image on the back. Line 2: the buyer's own unpublished image,
 * front only, quantity 2.
 */
async function seedCart(db: Db) {
  await makeUser(db, "seller");
  await makeUser(db, "buyer");
  const sold = await makeDesign(db, "seller");
  const listingId = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: LISTING_URL,
    publishedAt: new Date(),
  });
  const mine = await makeDesign(db, "buyer");
  const myImageId = await makeSourceImage(db, {
    designId: mine.id,
    ownerId: "buyer",
    imageUrl: MINE_URL,
  });

  await addToCart({
    frontImageId: listingId,
    back: myImageId,
    productId: PRODUCT,
    size: "L",
    color: "Black",
  });
  await addToCart({
    frontImageId: myImageId,
    productId: PRODUCT,
    size: "M",
    color: "Black",
  });
  const rows = await db.select().from(schema.cartItem);
  const second = rows.find((r) => r.size === "M");
  if (!second) throw new Error("seed: the second cart line is missing");
  await setCartItemQuantity(second.id, 2);

  return {
    listingId,
    myImageId,
    urlByImage: new Map([
      [listingId, LISTING_URL],
      [myImageId, MINE_URL],
    ]),
  };
}

/**
 * The hosted params checkoutCart sends, rebuilt with the real builder from
 * the rows it wrote. This is what pins "switch off is today, key for key"
 * without a hand-picked subset of properties and without writing a price
 * here. `expires_at` is clock-derived and asserted with `expect.any(Number)`.
 */
async function expectedHostedParams(
  db: Db,
  urlByImage: Map<string, string>
): Promise<Stripe.Checkout.SessionCreateParams> {
  const [order] = await db.select().from(schema.order);
  if (order.shippingPrice == null) {
    throw new Error("expected shippingPrice to be persisted");
  }
  const items = (await db.select().from(schema.orderItem)).filter(
    (i) => i.orderId === order.id
  );
  return buildCartCheckoutSessionParams({
    orderId: order.id,
    designId: order.designId,
    lineItems: items.map((i) => {
      const blank = getBlank(i.productId);
      if (!blank) throw new Error(`unknown blank ${i.productId}`);
      const front = i.placements?.front;
      return {
        name: blank.name,
        description: `${i.color} / ${i.size}${i.placements?.back ? " · front + back" : ""}`,
        imageUrl: front ? urlByImage.get(front) ?? null : null,
        unitPrice: i.itemPrice,
        quantity: i.quantity,
      };
    }),
    shippingPrice: order.shippingPrice,
    cancelUrl: `${APP_URL}/cart`,
    appUrl: APP_URL,
  });
}

function embeddedOn() {
  vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_abc123");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc123");
}

/** The lines console.error got that are about embedded checkout. */
function embeddedLogs(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.includes("embedded checkout"));
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = BUYER;
  h.sessionParams = [];
  h.rowsAtCreateTime = [];
  h.originHeader = null;
  h.stripeError = null;
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
  vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", undefined);
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", undefined);
  vi.stubEnv("STRIPE_SECRET_KEY", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("checkoutCart embedded-checkout gating (#278 slice 6b)", () => {
  it("switch off: the hosted session it has always built, the hosted url, nothing logged", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = h.db as Db;
    const ids = await seedCart(db);

    const result = await checkoutCart();

    expect(result).toEqual({ url: HOSTED_URL });
    const expected = await expectedHostedParams(db, ids.urlByImage);
    expect(h.sessionParams[0]).toEqual({
      ...expected,
      expires_at: expect.any(Number),
    });
    expect(embeddedLogs(errSpy)).toEqual([]);
  });

  it("switch on + valid key pair: an embedded session and the /checkout url whose Back is the cart", async () => {
    embeddedOn();
    const db = h.db as Db;
    const ids = await seedCart(db);

    const result = await checkoutCart();

    const hosted = await expectedHostedParams(db, ids.urlByImage);
    const [params] = h.sessionParams;
    expect(params).toEqual({
      ...hosted,
      expires_at: expect.any(Number),
      ui_mode: "embedded",
      return_url: `${APP_URL}${CONFIRM_PATH}`,
      success_url: undefined,
      cancel_url: undefined,
    });
    expect(params).not.toHaveProperty("success_url");
    expect(params).not.toHaveProperty("cancel_url");
    // One Stripe line per cart line, each with its own quantity.
    expect(params.line_items?.map((li) => li.quantity)).toEqual([1, 2]);
    expect(result).toEqual({ url: "/checkout?session=cs_test_1&from=%2Fcart" });
    expect(result.url).toBe(embeddedCheckoutPath("cs_test_1", "/cart"));
  });

  it.each([
    { reason: "missing-key", pk: undefined, sk: "sk_test_abc123" },
    { reason: "invalid-key", pk: "not-a-publishable-key", sk: "sk_test_abc123" },
    { reason: "mode-mismatch", pk: "pk_live_abc123", sk: "sk_test_abc123" },
  ])(
    "switch on + $reason: the hosted session and url, one log line naming the reason and no key",
    async ({ reason, pk, sk }) => {
      vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
      vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", pk);
      vi.stubEnv("STRIPE_SECRET_KEY", sk);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const db = h.db as Db;
      const ids = await seedCart(db);

      const result = await checkoutCart();

      expect(result).toEqual({ url: HOSTED_URL });
      const expected = await expectedHostedParams(db, ids.urlByImage);
      expect(h.sessionParams[0]).toEqual({
        ...expected,
        expires_at: expect.any(Number),
      });
      const logged = embeddedLogs(errSpy);
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain(reason);
      expect(logged[0]).toContain("cart");
      if (pk) expect(logged[0]).not.toContain(pk);
      expect(logged[0]).not.toContain(sk);
    }
  );

  it.each(["hosted", "embedded"] as const)(
    "%s: the order and every line are written before Stripe is called, and the session id is saved after",
    async (mode) => {
      if (mode === "embedded") embeddedOn();
      const db = h.db as Db;
      const ids = await seedCart(db);

      await checkoutCart();

      const atCreate = h.rowsAtCreateTime[0];
      expect(atCreate.orders).toHaveLength(1);
      expect(atCreate.orders[0].status).toBe("pending");
      expect(atCreate.orders[0].stripeSessionId).toBeNull();
      expect(atCreate.items).toHaveLength(2);
      expect(atCreate.items.map((i) => i.quantity)).toEqual([1, 2]);
      expect(atCreate.items.map((i) => i.placements)).toEqual([
        { front: ids.listingId, back: ids.myImageId },
        { front: ids.myImageId },
      ]);

      const [order] = await db.select().from(schema.order);
      expect(order.stripeSessionId).toBe("cs_test_1");
      expect(order.abandonedAt).toBeNull();
      // The cart is cleared by the webhook on payment, not here.
      expect(await db.select().from(schema.cartItem)).toHaveLength(2);
    }
  );

  it("the rows are the same in both modes: only the Stripe session shape and the returned url differ", async () => {
    const hostedDb = h.db as Db;
    await seedCart(hostedDb);
    await checkoutCart();
    const [hostedOrder] = await hostedDb.select().from(schema.order);
    const hostedItems = await hostedDb.select().from(schema.orderItem);

    h.db = await createTestDb();
    h.sessionParams = [];
    embeddedOn();
    const embeddedDb = h.db as Db;
    await seedCart(embeddedDb);
    await checkoutCart();
    const [embeddedOrder] = await embeddedDb.select().from(schema.order);
    const embeddedItems = await embeddedDb.select().from(schema.orderItem);

    const header = (o: OrderRow) => ({
      status: o.status,
      itemPrice: o.itemPrice,
      shippingPrice: o.shippingPrice,
      totalPrice: o.totalPrice,
      hasComposition: o.storeProductId !== null,
    });
    const line = (i: OrderItemRow) => ({
      productId: i.productId,
      size: i.size,
      color: i.color,
      quantity: i.quantity,
      itemPrice: i.itemPrice,
      hasBack: Boolean(i.placements?.back),
    });
    expect(header(embeddedOrder)).toEqual(header(hostedOrder));
    expect(embeddedItems.map(line)).toEqual(hostedItems.map(line));
  });
});

describe("checkoutCart return_url origin (#278 slice 6b)", () => {
  it("switch on: return_url follows a trusted Preview Origin, so a Preview purchase returns to that Preview", async () => {
    embeddedOn();
    h.originHeader = PREVIEW_ORIGIN;
    const db = h.db as Db;
    await seedCart(db);

    const result = await checkoutCart();

    expect(h.sessionParams[0].return_url).toBe(
      `${PREVIEW_ORIGIN}${CONFIRM_PATH}`
    );
    // The page URL handed to the browser is relative, so it stays there too.
    expect(result.url).toBe("/checkout?session=cs_test_1&from=%2Fcart");
  });

  it.each([
    "https://evil.example",
    // A prntd-* host without the team suffix is not this project's.
    "https://prntd-git-x.vercel.app",
    "javascript:alert(1)",
  ])(
    "switch on: an untrusted Origin (%s) falls back to NEXT_PUBLIC_APP_URL",
    async (origin) => {
      embeddedOn();
      h.originHeader = origin;
      const db = h.db as Db;
      await seedCart(db);

      await checkoutCart();

      expect(h.sessionParams[0].return_url).toBe(`${APP_URL}${CONFIRM_PATH}`);
    }
  );

  it("switch off: the hosted urls use NEXT_PUBLIC_APP_URL whatever the Origin is", async () => {
    h.originHeader = PREVIEW_ORIGIN;
    const db = h.db as Db;
    await seedCart(db);

    await checkoutCart();

    const [params] = h.sessionParams;
    expect(params.success_url).toBe(`${APP_URL}${CONFIRM_PATH}`);
    expect(params.cancel_url).toBe(`${APP_URL}/cart`);
    expect(params).not.toHaveProperty("return_url");
  });
});

describe("checkoutCart refusals and failures with the switch on (#278 slice 6b)", () => {
  it("Stripe throws: the order is abandoned with its lines kept, the error is re-thrown, the cart is intact", async () => {
    embeddedOn();
    const db = h.db as Db;
    await seedCart(db);
    const boom = new Error("stripe boom");
    h.stripeError = boom;

    await expect(checkoutCart()).rejects.toBe(boom);

    const orders = await db.select().from(schema.order);
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe("pending");
    expect(orders[0].abandonedAt).not.toBeNull();
    expect(orders[0].stripeSessionId).toBeNull();
    expect(await db.select().from(schema.orderItem)).toHaveLength(2);
    expect(await db.select().from(schema.cartItem)).toHaveLength(2);
  });

  it("a retry once Stripe recovers returns a /checkout url for a new order", async () => {
    embeddedOn();
    const db = h.db as Db;
    await seedCart(db);
    h.stripeError = new Error("stripe boom");
    await expect(checkoutCart()).rejects.toThrow("stripe boom");

    h.stripeError = null;
    const result = await checkoutCart();

    expect(result.url).toBe("/checkout?session=cs_test_1&from=%2Fcart");
    const orders = await db.select().from(schema.order);
    expect(orders).toHaveLength(2);
    const live = orders.filter((o) => o.abandonedAt === null);
    expect(live).toHaveLength(1);
    expect(live[0].stripeSessionId).toBe("cs_test_1");
  });

  it("an anonymous session: needsAuth, nothing written, Stripe not called", async () => {
    embeddedOn();
    const db = h.db as Db;
    await seedCart(db);
    h.session = { user: { id: "buyer", isAnonymous: true } };

    expect(await checkoutCart()).toEqual({ url: null, needsAuth: true });

    expect(await db.select().from(schema.order)).toHaveLength(0);
    expect(h.sessionParams).toHaveLength(0);
  });

  it("a line that became unavailable: the structured refusal, nothing written, Stripe not called", async () => {
    embeddedOn();
    const db = h.db as Db;
    const ids = await seedCart(db);
    // An admin hides the Shop image after it was added.
    await setPublication(db, ids.listingId, { isHidden: true });

    expect(await checkoutCart()).toEqual({
      url: null,
      error: CART_LINE_UNAVAILABLE,
    });

    expect(await db.select().from(schema.order)).toHaveLength(0);
    expect(h.sessionParams).toHaveLength(0);
    expect(await db.select().from(schema.cartItem)).toHaveLength(2);
  });

  it("an empty cart: { url: null }, nothing written, Stripe not called", async () => {
    embeddedOn();
    const db = h.db as Db;
    await makeUser(db, "buyer");

    expect(await checkoutCart()).toEqual({ url: null });

    expect(await db.select().from(schema.order)).toHaveLength(0);
    expect(h.sessionParams).toHaveLength(0);
  });
});

describe("each Checkout makes its own order and session (known behaviour, #278 slice 6b)", () => {
  it("switch on: a second Checkout leaves the first order pending with its own session", async () => {
    embeddedOn();
    const db = h.db as Db;
    await seedCart(db);

    const first = await checkoutCart();
    const second = await checkoutCart();

    expect(first.url).toBe(embeddedCheckoutPath("cs_test_1", "/cart"));
    expect(second.url).toBe(embeddedCheckoutPath("cs_test_2", "/cart"));
    const orders = await db.select().from(schema.order);
    expect(orders.map((o) => o.stripeSessionId).sort()).toEqual([
      "cs_test_1",
      "cs_test_2",
    ]);
    expect(
      orders.every((o) => o.status === "pending" && o.abandonedAt === null)
    ).toBe(true);
    expect(await db.select().from(schema.orderItem)).toHaveLength(4);
  });
});
```

Notes for the implementer:

- Everything a `vi.mock` factory needs lives in the `vi.hoisted` object `h` (the hosted URL included), because `vi.mock` is hoisted above the file's own constants.
- The seed uses sizes `L` and `M` in Black, which `src/lib/blanks.ts` lists for `bella-canvas-3001` (sizes at `:170`, Black at `:181`). If the seed throws, fix the seed, not product code, and keep the two lines' sizes different (the tests tell the lines apart by size).

- [ ] **Step 2: Run the file and note what fails**

Run: `npx vitest run src/app/cart/__tests__/checkout-cart-embedded.integration.test.ts`
Expected before any product change:

- FAIL: "switch on + valid key pair" (no `ui_mode`, hosted url); the three "switch on + <reason>" cases (no log line); "return_url follows a trusted Preview Origin" and the three "untrusted Origin" cases (`return_url` is undefined); "a retry once Stripe recovers" and "a second Checkout" (hosted urls).
- PASS: "switch off", both "written before Stripe is called" cases, "the rows are the same in both modes", "switch off: the hosted urls", "Stripe throws", "an anonymous session", "a line that became unavailable", "an empty cart". These pin what must not change; they must still pass after Step 3.

If a case listed under PASS fails, stop and report: the seed or a mock is wrong, or main has moved.

- [ ] **Step 3: Change `checkoutCart`**

In `src/app/cart/actions.ts`, add to the imports (next to the existing `@/lib/checkout` import at `:35`):

```ts
import { embeddedCheckoutFlag } from "@/lib/flags";
import {
  embeddedCheckoutConfig,
  embeddedCheckoutPath,
  resolveReturnOrigin,
} from "@/lib/embedded-checkout";
```

Add a module constant below `QUOTE_RECIPIENT` (it is not exported, so the `"use server"` rule is not affected):

```ts
// Where a buyer who backs out of checkout lands: Stripe's cancel link (hosted)
// or /checkout's Back link (embedded). A constant, never a client-sent path.
const CART_PATH = "/cart";
```

Inside `checkoutCart`, after the attribution block (the statement that ends `const storeProductId = cartOrderStoreProductId(…);` at `:601-607`) and before `const head = view.items[0];` (`:615`), insert:

```ts
  // #278 slice 6b: mount on our own /checkout page instead of Stripe's hosted
  // page when the switch is on and a usable key pair is configured, as the
  // image detail page does (buyPublishedDesign). The switch on with the config
  // disabled is a key problem, not a deliberate off: log the reason (never a
  // key) and use hosted checkout. Resolved here, before the order is written,
  // so nothing new can throw between the insert and the Stripe call.
  const embedded = embeddedCheckoutConfig();
  if (embeddedCheckoutFlag() && !embedded.enabled) {
    console.error(
      `embedded checkout disabled for the cart: ${embedded.reason} — using hosted checkout`
    );
  }
  // Hosted checkout always returns to NEXT_PUBLIC_APP_URL: the buyer leaves
  // our origin either way. An embedded session returns to the deployment it
  // was created on, so a purchase on a Preview lands on that Preview.
  const appUrl = embedded.enabled
    ? resolveReturnOrigin(
        (await headers()).get("origin"),
        process.env.NEXT_PUBLIC_APP_URL!
      )
    : process.env.NEXT_PUBLIC_APP_URL!;
```

In the `buildCartCheckoutSessionParams({ … })` call (`:645-658`), replace the last two properties:

```ts
        shippingPrice: view.shipping,
        // Ignored by an embedded session, whose way back is /checkout's own
        // Back link (the `from` in the returned path below).
        cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}${CART_PATH}`,
        appUrl,
        uiMode: embedded.enabled ? "embedded" : "hosted",
```

Replace the comment and `return` at the end of the function (`:673-677`):

```ts
  // The cart is NOT cleared here (#38): backing out returns to the cart (the
  // hosted cancel URL, or /checkout's Back link), which must still hold the
  // items. The webhook clears the purchased lines on payment.

  if (embedded.enabled) {
    return { url: embeddedCheckoutPath(checkoutSession.id, CART_PATH) };
  }
  return { url: checkoutSession.url };
```

Do not move, reorder or wrap anything else in the function. The `db.batch`, the `try`/`catch` around `stripe.checkout.sessions.create`, `abandonSessionlessOrder` and the `stripeSessionId` update stay exactly as they are.

- [ ] **Step 4: Update the comments this change makes stale**

`src/app/cart/actions.ts`, the docblock above `checkoutCart` (`:520-533`): append this paragraph inside the comment, after the existing text:

```ts
 *
 * The returned `url` is where the cart page sends the browser (#278 slice
 * 6b). With EMBEDDED_CHECKOUT_ENABLED on and a usable key pair the session is
 * embedded and `url` is our own `/checkout?session=…&from=/cart` path;
 * otherwise it is Stripe's hosted URL, as before. Each call makes a new order
 * and session; an earlier session stays payable until it expires.
```

`src/app/cart/actions.ts:48-51`, the comment above `QUOTE_RECIPIENT`: replace it with

```ts
// Indicative destination for the cart's shipping estimate. Shipping is quoted
// once, at cart time, against a representative US address, and that quoted
// amount is what gets charged (#26 B2/B4). Hosted Stripe Checkout cannot
// recompute it after the buyer enters an address; Embedded Checkout could,
// and deliberately does not here (#278 slice 6b left shipping unchanged).
```

`src/lib/flags.ts`, the docblock above `embeddedCheckoutFlag` (`:29-41`): change "purchases started on the image detail page open Stripe Embedded Checkout" to "purchases started on the image detail page or from the cart (#278 slice 6b) open Stripe Embedded Checkout", and "creating on the image detail page uses `embeddedCheckoutConfig()`" to "creating on the image detail page or from the cart uses `embeddedCheckoutConfig()`". Leave the rest of the comment alone (slice 6a rewrites it). These phrases wrap across comment lines in the source; reflow the lines you touch.

`src/lib/embedded-checkout.ts`:
- `:8` — "`embeddedCheckoutConfig()` (image detail page, EMBEDDED_CHECKOUT_ENABLED)" becomes "`embeddedCheckoutConfig()` (image detail page and cart, EMBEDDED_CHECKOUT_ENABLED)".
- `:60-63` — "for the image detail page's buy action (EMBEDDED_CHECKOUT_ENABLED)" becomes "for the image detail page's buy action and the cart's checkout (EMBEDDED_CHECKOUT_ENABLED)".
- `:121-123` — "The relative path `buyPublishedDesign` and `createCheckoutSession` return" becomes "The relative path `buyPublishedDesign`, `checkoutCart` and `createCheckoutSession` return".

No code changes in those two files.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/app/cart src/lib/__tests__/checkout.test.ts src/lib/__tests__/money-path.integration.test.ts src/app/d/__tests__/render-pin-source.integration.test.ts && npm run typecheck && npm run lint`
Expected: PASS, clean. Every case in the new file passes, and every existing cart test still passes unchanged (they run with the switch unset).

- [ ] **Step 6: Commit**

```bash
git add src/app/cart/actions.ts src/lib/flags.ts src/lib/embedded-checkout.ts src/app/cart/__tests__/checkout-cart-embedded.integration.test.ts
git commit -m "checkoutCart: embedded session behind EMBEDDED_CHECKOUT_ENABLED, hosted fallback, /checkout url back to the cart (#278 slice 6b)"
```

---

### Task 3: The cart page shows the checkout-failed line when the action throws

**Files:**
- Modify: `src/app/cart/page.tsx:14` (import) and `:113-132` (`handleCheckout`)
- Test: `src/app/cart/__tests__/cart-page.test.tsx` (append a `describe`)

**Interfaces:**
- Consumes: `checkoutCart(): Promise<{ url: string | null; needsAuth?: boolean; error?: string }>`, which throws on failure; `CHECKOUT_FAILED` and `CART_LINE_UNAVAILABLE` from `src/lib/action-copy.ts` (both exist).
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing tests**

In `src/app/cart/__tests__/cart-page.test.tsx`, add to the imports:

```tsx
import { CHECKOUT_FAILED, CART_LINE_UNAVAILABLE } from "@/lib/action-copy";
```

Append at the end of the file:

```tsx
/**
 * Replace window.location so an href assignment is recorded instead of
 * attempted (jsdom does not navigate). Call `restore` in a `finally`.
 */
function stubLocationHref() {
  const hrefSet = vi.fn();
  const original = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      get pathname() {
        return original.pathname;
      },
      get search() {
        return original.search;
      },
      set href(value: string) {
        hrefSet(value);
      },
    },
  });
  return {
    hrefSet,
    restore: () =>
      Object.defineProperty(window, "location", {
        configurable: true,
        value: original,
      }),
  };
}

describe("CartPage checkout (#278 slice 6b)", () => {
  const EMBEDDED_PATH = "/checkout?session=cs_test_abc&from=%2Fcart";

  it("follows the url checkoutCart returns, our own relative /checkout path included", async () => {
    const loc = stubLocationHref();
    try {
      getCart.mockResolvedValue(ONE_ITEM);
      checkoutCart.mockResolvedValue({ url: EMBEDDED_PATH });
      render(<CartPage />);

      fireEvent.click(await screen.findByRole("button", { name: /^Checkout/ }));

      await waitFor(() =>
        expect(loc.hrefSet).toHaveBeenCalledWith(EMBEDDED_PATH)
      );
      expect(screen.queryByTestId("cart-checkout-error")).not.toBeInTheDocument();
    } finally {
      loc.restore();
    }
  });

  it("needsAuth sends the buyer to sign-in and back to the cart", async () => {
    const loc = stubLocationHref();
    try {
      getCart.mockResolvedValue(ONE_ITEM);
      checkoutCart.mockResolvedValue({ url: null, needsAuth: true });
      render(<CartPage />);

      fireEvent.click(await screen.findByRole("button", { name: /^Checkout/ }));

      await waitFor(() =>
        expect(loc.hrefSet).toHaveBeenCalledWith("/sign-in?next=/cart")
      );
    } finally {
      loc.restore();
    }
  });

  it("a thrown checkout shows the checkout-failed line, not the thrown message, and gives the button back", async () => {
    const loc = stubLocationHref();
    try {
      getCart.mockResolvedValue(ONE_ITEM);
      checkoutCart.mockRejectedValue(new Error("digest 123: masked in production"));
      render(<CartPage />);

      fireEvent.click(await screen.findByRole("button", { name: /^Checkout/ }));

      const notice = await screen.findByTestId("cart-checkout-error");
      expect(notice).toHaveTextContent(CHECKOUT_FAILED);
      expect(notice).not.toHaveTextContent("masked in production");
      expect(
        await screen.findByRole("button", { name: /^Checkout/ })
      ).toBeEnabled();
      expect(loc.hrefSet).not.toHaveBeenCalled();
      // Nothing about the cart changed, so it is not re-read.
      expect(getCart).toHaveBeenCalledTimes(1);
    } finally {
      loc.restore();
    }
  });

  it("the next attempt clears the notice", async () => {
    const loc = stubLocationHref();
    try {
      getCart.mockResolvedValue(ONE_ITEM);
      checkoutCart
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce({ url: EMBEDDED_PATH });
      render(<CartPage />);

      fireEvent.click(await screen.findByRole("button", { name: /^Checkout/ }));
      await screen.findByTestId("cart-checkout-error");
      fireEvent.click(await screen.findByRole("button", { name: /^Checkout/ }));

      await waitFor(() =>
        expect(loc.hrefSet).toHaveBeenCalledWith(EMBEDDED_PATH)
      );
      expect(screen.queryByTestId("cart-checkout-error")).not.toBeInTheDocument();
    } finally {
      loc.restore();
    }
  });

  it("a refusal keeps its own message when the cart re-read after it fails", async () => {
    getCart
      .mockResolvedValueOnce(ONE_ITEM)
      .mockRejectedValue(new Error("re-read failed"));
    checkoutCart.mockResolvedValue({ url: null, error: CART_LINE_UNAVAILABLE });
    render(<CartPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^Checkout/ }));

    const notice = await screen.findByTestId("cart-checkout-error");
    expect(notice).toHaveTextContent(CART_LINE_UNAVAILABLE);
    expect(
      await screen.findByRole("button", { name: /^Checkout/ })
    ).toBeEnabled();
    expect(screen.getByTestId("cart-checkout-error")).not.toHaveTextContent(
      CHECKOUT_FAILED
    );
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/app/cart/__tests__/cart-page.test.tsx`
Expected: the first two cases PASS (they pin that a relative URL is followed and the sign-in path). "a thrown checkout" and "the next attempt" FAIL: no `cart-checkout-error` appears, because `handleCheckout` has no `catch`. "a refusal keeps its own message" fails the run with an unhandled rejection ("re-read failed"), because the re-read is not guarded.

- [ ] **Step 3: Rewrite `handleCheckout`**

In `src/app/cart/page.tsx`, add `CHECKOUT_FAILED` to the existing `@/lib/action-copy` import on `:14`:

```tsx
import {
  CART_LINE_UNAVAILABLE_LABEL,
  CHECKOUT_FAILED,
  QUANTITY_UPDATE_FAILED,
} from "@/lib/action-copy";
```

Replace `handleCheckout` (`:113-132`) with:

```tsx
  async function handleCheckout() {
    setCheckingOut(true);
    setCheckoutError(null);
    try {
      let result: Awaited<ReturnType<typeof checkoutCart>>;
      try {
        result = await checkoutCart();
      } catch {
        // The action threw (Stripe unavailable, a lost response). Production
        // masks the message, so the notice is fixed copy, the line the image
        // detail page shows. It is true here: no session reached the buyer,
        // so nothing was charged. The cart is unchanged, so no re-read.
        setCheckoutError(CHECKOUT_FAILED);
        return;
      }
      const { url, needsAuth, error } = result;
      if (error) {
        setCheckoutError(error);
        // Re-read the cart so the line that failed carries its label. If the
        // re-read fails the refusal stays on screen.
        try {
          await refresh();
        } catch {
          // Keep the refusal; the next attempt re-reads.
        }
        return;
      }
      if (needsAuth) {
        window.location.href = "/sign-in?next=/cart";
        return;
      }
      // Hosted checkout is an absolute Stripe URL; embedded checkout is our
      // own /checkout path (#278 slice 6b). Both are document navigations.
      if (url) window.location.href = url;
    } finally {
      setCheckingOut(false);
    }
  }
```

Update the comment above the `checkoutError` state (`:48-49`) to: `// checkoutCart's refusal ({ error }) or, when the action throws, the fixed checkout-failed line; shown above the buttons. A refused line is marked by getCart.`

Nothing in the JSX changes: the notice slot (`cart-checkout-error`) and the button are already there.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/cart/__tests__/cart-page.test.tsx && npm run typecheck && npm run lint`
Expected: PASS, clean, with no unhandled-rejection report.

- [ ] **Step 5: Commit**

```bash
git add src/app/cart/page.tsx src/app/cart/__tests__/cart-page.test.tsx
git commit -m "Cart page: show the checkout-failed line when checkoutCart throws (#278 slice 6b)"
```

---

### Task 4: `/checkout` with more than one line: loader and page tests, compact rows

**Files:**
- Modify: `src/app/checkout/checkout-line.tsx:22` (props) and `:61-66` (two class strings)
- Modify: `src/app/checkout/page.tsx:26-33` (docblock) and `:177-185` (`ReviewBlock`)
- Test: `src/app/checkout/__tests__/checkout-line.test.tsx`, `src/app/checkout/__tests__/page.test.tsx`, `src/lib/__tests__/embedded-checkout-session.integration.test.ts`

**Interfaces:**
- Consumes: `CheckoutLineSummary` and `loadEmbeddedCheckout` from `src/lib/embedded-checkout-session.ts`, unchanged.
- Produces: `CheckoutLine`'s `compact?: boolean`; `data-testid="checkout-review"` on the review block's wrapper.

The loader (`src/lib/embedded-checkout-session.ts`) is not edited. Its new tests are expected to pass as written; they are the multi-line coverage that was missing. If one fails, that is a finding: stop and report it, do not edit the loader to make it pass.

- [ ] **Step 1: Loader tests for a cart order**

In `src/lib/__tests__/embedded-checkout-session.integration.test.ts`, add to the imports:

```ts
import { computePrice } from "@/lib/pricing";
import { getBlank, getColorHex } from "@/lib/blanks";
```

Append at the end of the file:

```ts
const CART_PRODUCT = "bella-canvas-3001";

/**
 * An order shaped like the ones checkoutCart writes: one header and several
 * order_item rows from one INSERT, with lines from more than one design.
 * Prices come from computePrice so no amount is written here.
 */
async function seedCartOrder(db: Db, stripeSessionId: string) {
  await makeUser(db, "buyer");
  await makeUser(db, "seller");
  const mine = await makeDesign(db, "buyer");
  const firstId = await makeSourceImage(db, {
    designId: mine.id,
    ownerId: "buyer",
    imageUrl: "https://img.example/mine-first.png",
  });
  const secondId = await makeSourceImage(db, {
    designId: mine.id,
    ownerId: "buyer",
    imageUrl: "https://img.example/mine-second.png",
  });
  const sold = await makeDesign(db, "seller");
  const listingId = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: "https://img.example/listing.png",
    publishedAt: new Date(),
  });
  // The buyer's design caches two Black front mockups: one keyed by the first
  // image, and the old source-less one that stands for the design's primary
  // (the first image). Neither belongs to the second image.
  await db
    .update(schema.design)
    .set({
      primaryImageId: firstId,
      mockupUrls: {
        [mockupCacheKey({
          productId: CART_PRODUCT,
          placementId: "front",
          sourceImageId: firstId,
          colorName: "Black",
          scaleKey: 100,
        })]: "https://r2.example/mine-first-black.jpg",
        [mockupCacheKey({
          productId: CART_PRODUCT,
          placementId: "front",
          colorName: "Black",
          scaleKey: 100,
        })]: "https://r2.example/mine-default-black.jpg",
      },
    })
    .where(eq(schema.design.id, mine.id));

  const unit = (size: string, back = false) =>
    computePrice(0, CART_PRODUCT, size, { back }).total;
  const [order] = await db
    .insert(schema.order)
    .values({
      userId: "buyer",
      designId: mine.id,
      stripeSessionId,
      status: "pending",
      totalPrice: unit("M") + 2 * unit("L", true) + unit("S"),
    })
    .returning();
  await db.insert(schema.orderItem).values([
    {
      orderId: order.id,
      designId: mine.id,
      productId: CART_PRODUCT,
      size: "M",
      color: "Black",
      placements: { front: firstId },
      quantity: 1,
      itemPrice: unit("M"),
    },
    {
      orderId: order.id,
      designId: sold.id,
      productId: CART_PRODUCT,
      size: "L",
      color: "White",
      placements: { front: listingId, back: firstId },
      quantity: 2,
      itemPrice: unit("L", true),
    },
    {
      orderId: order.id,
      designId: mine.id,
      productId: CART_PRODUCT,
      size: "S",
      color: "Black",
      placements: { front: secondId },
      quantity: 1,
      itemPrice: unit("S"),
    },
  ]);
}

describe("loadEmbeddedCheckout for a cart order (#278 slice 6b)", () => {
  it("returns one summary entry per order line, each with its own artwork, colour, size, quantity and mockup", async () => {
    const db = h.db as Db;
    await seedCartOrder(db, "cs_test_cart1");
    h.retrieve.mockResolvedValue(OPEN_EMBEDDED);

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_cart1",
      viewerId: "buyer",
    });

    if (result.kind !== "ready") throw new Error(`expected ready, got ${result.kind}`);
    const productName = getBlank(CART_PRODUCT)?.name ?? null;
    // The three lines share one created_at second (one INSERT), so this also
    // pins that the summary comes back in insert order, which is cart order.
    expect(result.summary).toEqual([
      {
        productName,
        color: "Black",
        size: "M",
        quantity: 1,
        frontImageUrl: "https://img.example/mine-first.png",
        backImageUrl: null,
        colorHex: getColorHex(CART_PRODUCT, "Black"),
        mockupUrl: "https://r2.example/mine-first-black.jpg",
      },
      {
        productName,
        color: "White",
        size: "L",
        quantity: 2,
        frontImageUrl: "https://img.example/listing.png",
        backImageUrl: "https://img.example/mine-first.png",
        colorHex: getColorHex(CART_PRODUCT, "White"),
        mockupUrl: null,
      },
      {
        productName,
        color: "Black",
        size: "S",
        quantity: 1,
        frontImageUrl: "https://img.example/mine-second.png",
        backImageUrl: null,
        colorHex: getColorHex(CART_PRODUCT, "Black"),
        // Same design and colour as line 1, a different front: neither of the
        // design's cached mockups is this line's artwork.
        mockupUrl: null,
      },
    ]);
    expect(h.retrieve).toHaveBeenCalledTimes(1);
  });

  it("the summary carries no price field for any line", async () => {
    const db = h.db as Db;
    await seedCartOrder(db, "cs_test_cart2");
    h.retrieve.mockResolvedValue(OPEN_EMBEDDED);

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_cart2",
      viewerId: "buyer",
    });

    if (result.kind !== "ready") throw new Error(`expected ready, got ${result.kind}`);
    expect(result.summary).toHaveLength(3);
    for (const line of result.summary) {
      expect(
        Object.keys(line).filter((key) => /price|total|amount|cost/i.test(key))
      ).toEqual([]);
    }
  });

  it("another account opening a cart session gets not-found and Stripe is not called", async () => {
    const db = h.db as Db;
    await seedCartOrder(db, "cs_test_cart3");

    const result = await loadEmbeddedCheckout({
      sessionId: "cs_test_cart3",
      viewerId: "seller",
    });

    expect(result).toEqual({ kind: "not-found" });
    expect(h.retrieve).not.toHaveBeenCalled();
  });
});
```

Run: `npx vitest run src/lib/__tests__/embedded-checkout-session.integration.test.ts`
Expected: PASS (new and existing). A failure here is a single-line assumption in the loader that the survey and this plan missed: stop and report it with the failing diff.

- [ ] **Step 2: Failing tests for the compact row**

In `src/app/checkout/__tests__/checkout-line.test.tsx`, append:

```tsx
describe("CheckoutLine compact (a cart order's lines, #278 slice 6b)", () => {
  it("default: the laptop layout's full-width square, as before", () => {
    render(<CheckoutLine line={base} />);
    const tile = screen.getByTestId("checkout-preview");
    expect(tile.className).toContain("md:aspect-square");
    expect(tile.parentElement?.className).toContain("md:flex-col");
  });

  it("compact: the row layout at every width, with the same tile, text and viewer", () => {
    render(<CheckoutLine line={{ ...base, quantity: 2 }} compact />);
    const tile = screen.getByTestId("checkout-preview");
    expect(tile.className).not.toMatch(/\bmd:/);
    expect(tile.className).toContain("w-24");
    expect(tile.className).toContain("h-24");
    expect(tile.parentElement?.className).not.toMatch(/\bmd:/);
    expect(screen.getByText(/×2/)).toBeInTheDocument();
    expect(screen.getByText("Black / M")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View larger: Classic Tee" }));
    expect(screen.getByTestId("checkout-viewer-face")).toHaveAttribute(
      "data-side",
      "front"
    );
  });
});
```

In `src/app/checkout/__tests__/page.test.tsx`:

Add `within` to the Testing Library import: `import { render, screen, fireEvent, within } from "@testing-library/react";`.

Extend the `EmbeddedCheckoutForm` mock (`:40-51`) so the Back target it is given can be read:

```tsx
vi.mock("../embedded-checkout-form", () => ({
  EmbeddedCheckoutForm: (props: {
    publishableKey: string;
    clientSecret: string;
    backHref: string;
  }) => {
    h.formRenders();
    return (
      <div
        data-testid="embedded-checkout-form-mock"
        data-secret={props.clientSecret}
        data-key={props.publishableKey}
        data-back={props.backHref}
      />
    );
  },
}));
```

Append inside `describe("CheckoutPage", …)`:

```tsx
  const TWO_LINES = {
    kind: "ready",
    clientSecret: "cs_secret_abc",
    publishableKey: "pk_test_abc123",
    summary: [
      {
        productName: "Classic Tee",
        color: "Black",
        size: "M",
        quantity: 1,
        frontImageUrl: "https://img.example/a.png",
        backImageUrl: null,
        colorHex: "#0c0c0c",
        mockupUrl: null,
      },
      {
        productName: "Classic Tee",
        color: "White",
        size: "L",
        quantity: 2,
        frontImageUrl: "https://img.example/b.png",
        backImageUrl: "https://img.example/b-back.png",
        colorHex: "#ffffff",
        mockupUrl: null,
      },
    ],
  };

  it("a cart session: one review row per line in compact rows, Back to the cart, one form, no $", async () => {
    h.loadEmbeddedCheckout.mockResolvedValue(TWO_LINES);

    render(await renderCheckout({ session: VALID_SESSION, from: "/cart" }));

    const review = screen.getByTestId("checkout-review");
    const tiles = within(review).getAllByTestId("checkout-preview");
    expect(tiles).toHaveLength(2);
    for (const tile of tiles) {
      expect(tile.className).not.toContain("md:aspect-square");
    }
    expect(within(review).getByText("Black / M")).toBeInTheDocument();
    expect(within(review).getByText("White / L")).toBeInTheDocument();
    expect(within(review).getByText(/×2/)).toBeInTheDocument();
    expect(within(review).getAllByText("Back design")).toHaveLength(1);
    expect(review.textContent).not.toContain("$");

    expect(screen.getByRole("link", { name: "← Back" })).toHaveAttribute(
      "href",
      "/cart"
    );
    const forms = screen.getAllByTestId("embedded-checkout-form-mock");
    expect(forms).toHaveLength(1);
    expect(forms[0]).toHaveAttribute("data-back", "/cart");
  });

  it("a cart session: each line's viewer opens that line's artwork", async () => {
    h.loadEmbeddedCheckout.mockResolvedValue(TWO_LINES);
    render(await renderCheckout({ session: VALID_SESSION, from: "/cart" }));

    const buttons = screen.getAllByRole("button", {
      name: "View larger: Classic Tee",
    });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);

    const face = screen.getByTestId("checkout-viewer-face");
    expect(within(face).getByRole("img")).toHaveAttribute(
      "src",
      "https://img.example/b.png"
    );
  });

  it("a single-line order keeps the laptop square inside the review block", async () => {
    h.loadEmbeddedCheckout.mockResolvedValue({
      ...TWO_LINES,
      summary: [TWO_LINES.summary[0]],
    });

    render(await renderCheckout({ session: VALID_SESSION, from: "/d/img-1" }));

    const review = screen.getByTestId("checkout-review");
    expect(
      within(review).getByTestId("checkout-preview").className
    ).toContain("md:aspect-square");
  });

  it("a cart session's sign-in round trip returns to the same /checkout url", async () => {
    h.session = null;
    const expectedNext = embeddedCheckoutPath(VALID_SESSION, "/cart");

    await expect(
      renderCheckout({ session: VALID_SESSION, from: "/cart" })
    ).rejects.toThrow(
      `NEXT_REDIRECT:/sign-in?next=${encodeURIComponent(expectedNext)}`
    );
    expect(h.loadEmbeddedCheckout).not.toHaveBeenCalled();
  });

  it("a cart session's expired screen backs out to the cart", async () => {
    h.loadEmbeddedCheckout.mockResolvedValue({ kind: "expired" });

    render(await renderCheckout({ session: VALID_SESSION, from: "/cart" }));

    expect(screen.getByRole("link", { name: "← Back" })).toHaveAttribute(
      "href",
      "/cart"
    );
  });

  it("no from (the link /order/confirm builds for an open session): Back is the Shop", async () => {
    h.loadEmbeddedCheckout.mockResolvedValue(TWO_LINES);

    render(await renderCheckout({ session: VALID_SESSION }));

    expect(screen.getByRole("link", { name: "← Back" })).toHaveAttribute(
      "href",
      "/shop"
    );
  });
```

Run: `npx vitest run src/app/checkout`
Expected: FAIL in the two `compact` cases (the prop does not exist, so the `md:` classes are still there) and in "a cart session: one review row per line" and "a single-line order keeps…" (no `checkout-review` test id). The viewer, sign-in, expired and no-`from` cases PASS already; they pin behaviour that exists.

- [ ] **Step 3: The `compact` prop**

In `src/app/checkout/checkout-line.tsx`, change the signature (`:22`):

```tsx
export function CheckoutLine({
  line,
  compact = false,
}: {
  line: CheckoutLineSummary;
  /** Set when the summary has more than one line (a cart order, #278 slice
   * 6b). From `md` up a line becomes a full-width square, which is sized for
   * one shirt; several would stack one large square per line beside the
   * payment form. Compact keeps the phone's row, tile beside the text, at
   * every width. */
  compact?: boolean;
}) {
```

Replace the row `div` and the tile `div` opening tags (`:61-66`) with complete class strings per branch (Tailwind only sees whole class names in the source):

```tsx
      <div
        className={
          compact
            ? "flex items-center gap-3"
            : "flex items-center gap-3 md:flex-col md:items-stretch md:gap-2"
        }
      >
        <div
          data-testid="checkout-preview"
          className={
            compact
              ? "relative w-24 h-24 border border-border overflow-hidden flex-shrink-0"
              : "relative w-24 h-24 md:w-full md:h-auto md:aspect-square border border-border overflow-hidden flex-shrink-0"
          }
          style={{ backgroundColor: line.colorHex }}
        >
```

Nothing else in the component changes. Add one sentence to the component's docblock: `A cart order's lines are rendered \`compact\` (see the prop).`

- [ ] **Step 4: The review block**

In `src/app/checkout/page.tsx`, replace `ReviewBlock` (`:177-185`):

```tsx
function ReviewBlock({ summary }: { summary: CheckoutLineSummary[] }) {
  // More than one line is a cart order (#278 slice 6b): rows at every width.
  const compact = summary.length > 1;
  return (
    <div data-testid="checkout-review" className="space-y-4">
      {summary.map((line, i) => (
        <CheckoutLine key={i} line={line} compact={compact} />
      ))}
    </div>
  );
}
```

In the page's docblock (`:26-33`), change "Serves both buy surfaces, the image detail page (EMBEDDED_CHECKOUT_ENABLED) and /preview (PREVIEW_EMBEDDED_CHECKOUT_ENABLED), and 404s unless either is on." to "Serves the image detail page and the cart (both EMBEDDED_CHECKOUT_ENABLED; a cart session arrives with `from=/cart`) and /preview (PREVIEW_EMBEDDED_CHECKOUT_ENABLED), and 404s unless either switch is on." Leave the rest (slice 6a rewrites it).

In the docblock above `ReviewBlock` (`:166-176`), append: `One row per order line; a cart order has several, and then every row is compact.`

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/app/checkout src/lib/__tests__/embedded-checkout-session.integration.test.ts src/lib/__tests__/no-preselection-price.test.ts && npm run typecheck && npm run lint`
Expected: PASS, clean. The existing single-line assertion at `page.test.tsx:260-262` (`md:aspect-square`) still passes.

- [ ] **Step 6: Commit**

```bash
git add src/app/checkout/checkout-line.tsx src/app/checkout/page.tsx src/app/checkout/__tests__/checkout-line.test.tsx src/app/checkout/__tests__/page.test.tsx src/lib/__tests__/embedded-checkout-session.integration.test.ts
git commit -m "/checkout with several lines: loader and page tests, compact review rows (#278 slice 6b)"
```

---

### Task 5: Nightly Stripe e2e: the cart pays through the embedded form; docs

**Files:**
- Modify: `e2e/stripe-money-path.spec.ts` — header comment (`:1-32`), imports (`:40-51`), the cart test (`:280-373`), two lines in `buyFromImagePage` (`:431-433`, `:452-455`)
- Modify: `docs/stripe-e2e.md`
- Modify (comments only): `.github/workflows/stripe-e2e.yml:3-11`, `:41-45`
- Modify: `CLAUDE.md` — three standing lines (not "Current state")
- Modify: `docs/superpowers/plans/2026-10-01-one-buy-surface.md:984` — one note

**Interfaces:**
- Consumes: the cart's Checkout landing on `/checkout?session=cs_test_…&from=%2Fcart` (Task 2); `data-testid="checkout-review"` wrapping one `checkout-preview` per line, and the "← Back" link (Task 4). Existing helpers in the spec, unchanged: `embeddedStripeRoot(page): Promise<FrameLocator>`, `completeStripeCheckout(root, email)`. Existing helper in `e2e/helpers/db.ts`: `cartItemsForUser(userId)`.
- Produces: nothing other tasks use.

This spec cannot run in PR CI or without a Stripe test key. Its real run is the dispatched workflow in Task 8. In this task it is checked by the typecheck (the root `tsconfig.json` includes `e2e/**`) and by Playwright's listing.

- [ ] **Step 1: The cart test**

Add `cartItemsForUser` to the import from `./helpers/db`.

Replace the cart test (`test("hosted checkout → signed webhook → submitted order + sale/fee ledger", …)`, `:280-373`) with:

```ts
  test("cart: two designs → embedded checkout on /checkout → signed webhook → submitted order + sale/fee ledger, cart emptied", async ({
    page,
  }, testInfo) => {
    // Stripe iframe load + payment settle + webhook forward all add up.
    test.setTimeout(300_000);
    // Production's setting for the cart since #278 slice 6b: it rides the
    // image detail page's switch. Not optional here: the point of this test
    // is the path production runs.
    expect(
      process.env.EMBEDDED_CHECKOUT_ENABLED,
      "this test covers the embedded path: set EMBEDDED_CHECKOUT_ENABLED=true (the nightly workflow does)"
    ).toBe("true");
    const key = `${Date.now()}-${testInfo.project.name}`;
    const seeded: string[] = [];
    let userId = "";

    try {
      // Checkout is the funnel's auth gate, so pay as a fresh real account
      // (a guest would be bounced to sign-in instead of the payment form).
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

      // Waiting on either URL and then asserting turns a fail-closed fallback
      // to the hosted page into a red run.
      await page.waitForURL(
        /\/checkout\?session=cs_test_|checkout\.stripe\.com/,
        { timeout: 60_000 }
      );
      expect(
        page.url(),
        "cart checkout opened on Stripe's hosted page — is EMBEDDED_CHECKOUT_ENABLED on and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY set at build time, from the same Stripe test account as STRIPE_SECRET_KEY?"
      ).toMatch(/\/checkout\?session=cs_test_/);
      const checkoutUrl = new URL(page.url());
      const sessionId = checkoutUrl.searchParams.get("session");
      expect(sessionId, `no cs_test_… in checkout URL: ${page.url()}`).toMatch(
        /^cs_test_[A-Za-z0-9]+$/
      );
      // A cart session's way back is the cart.
      expect(checkoutUrl.searchParams.get("from")).toBe("/cart");
      await expect(
        page.getByRole("link", { name: "← Back" }).first()
      ).toHaveAttribute("href", "/cart");

      // One review row per cart line, and no price of ours beside them
      // (Stripe's form, in its own iframe, is where prices show).
      const review = page.getByTestId("checkout-review");
      await expect(review.getByTestId("checkout-preview")).toHaveCount(2, {
        timeout: 30_000,
      });
      expect(await review.innerText()).not.toContain("$");

      await completeStripeCheckout(
        await embeddedStripeRoot(page),
        `e2e-buyer-${key}@prntd.test`
      );

      // Stripe settles the payment and sends the browser to return_url.
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
      // Dry-run Printful: fake id, no real shirt and no cost, so no COGS row.
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

      // The webhook clears the purchased lines on payment (#38). The cart
      // survived session creation, so this is the first point it is empty.
      await expect
        .poll(async () => (await cartItemsForUser(userId)).length, {
          timeout: 30_000,
        })
        .toBe(0);
    } finally {
      // Orders first (FK to design + user), then designs, then the account.
      await cleanupOrdersForDesigns(seeded);
      await cleanupDesigns(seeded);
      await cleanupUser(userId);
    }
  });
```

What is new compared with the existing test: the switch assertion at the top; the block from "Waiting on either URL" to `completeStripeCheckout(await embeddedStripeRoot(page), …)`, which replaces the wait for `checkout.stripe.com` and the hosted `completeStripeCheckout(page, …)`; and the cart-emptied poll at the end. The sign-up, seeding, add-to-cart, order, ledger and line assertions are the existing test's, carried over.

- [ ] **Step 2: Count and scope `checkout-preview` in `buyFromImagePage`**

With a cart order the test id matches once per line. The two single-item tests assert there is exactly one, and scope the click:

At `:431-433`, replace

```ts
      await expect(page.getByTestId("checkout-preview")).toBeVisible({
        timeout: 30_000,
      });
```

with

```ts
      // One order line, so one review row (a cart order has one per line).
      await expect(page.getByTestId("checkout-preview")).toHaveCount(1, {
        timeout: 30_000,
      });
```

At `:452-455`, replace `page.getByTestId("checkout-preview").getByRole(…)` with `page.getByTestId("checkout-preview").first().getByRole("button", { name: "View larger" })`.

- [ ] **Step 3: The spec's header comment**

Replace the paragraph that starts "Three tests. The cart test pays through Stripe's hosted page" (`:7-17`) with:

```ts
 * Three tests, all paying through Stripe Embedded Checkout on our own
 * /checkout page, which is how production sells from the image detail page
 * and, since #278 slice 6b, from the cart (EMBEDDED_CHECKOUT_ENABLED, with
 * NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY set at build time). All three require
 * that switch, and landing on checkout.stripe.com fails the test instead of
 * falling back, so a missing or mismatched publishable key turns the run
 * red. The cart test checks out two designs together and asserts both order
 * lines and the emptied cart. The image-detail-page test orders the owner's
 * own UNPUBLISHED image from the Order panel (one buy surface, slice 3), and
 * the order it creates must carry no Shop composition. The last test does
 * the same purchase but enters through an old /preview link, which redirects
 * to the image detail page with the picks (slice 4). Nothing here pays
 * through Stripe's hosted page any more; hosted is the fail-closed fallback
 * and is covered by the parameter tests in Vitest.
```

- [ ] **Step 4: Check the spec without running it**

Run: `npm run typecheck && npx playwright test e2e/stripe-money-path.spec.ts --list`
Expected: typecheck clean; the listing shows three tests under "stripe money path", the first named "cart: two designs → embedded checkout on /checkout → …".

- [ ] **Step 5: `docs/stripe-e2e.md`**

- First bullet under the intro (`:8-9`): replace with

```md
- The cart test adds two designs to the cart from their image detail pages,
  taps Checkout, and pays through embedded checkout on our `/checkout` page,
  as production does since #278 slice 6b (the cart rides
  `EMBEDDED_CHECKOUT_ENABLED`). It requires that switch to be `true` and fails
  rather than skipping when it is not, and it fails if checkout opens on
  Stripe's hosted page. Beyond the common assertions it checks that
  `/checkout` shows one review row per line with no price, that Back points
  at `/cart`, that the order has both lines with their own pinned images, and
  that the cart is empty once the webhook has run.
```

- In "Run", item 4 (`:62`): "two payments per run" becomes "three payments per run".
- In "Nightly CI run", the paragraph starting "It moves money through two Stripe surfaces" (`:83-88`): replace with

```md
All three tests pay through the embedded checkout iframe on `/checkout`. The
switch (`EMBEDDED_CHECKOUT_ENABLED`) is on in production for the image detail
page and the cart, so the nightly matches production on both. Nothing in the
nightly pays through Stripe's hosted page: hosted checkout is the fail-closed
fallback (a missing or mismatched publishable key) and is covered by the
parameter tests in Vitest. Nothing reads `PREVIEW_EMBEDDED_CHECKOUT_ENABLED`.
```

- Rename the section "## Embedded checkout (image detail page)" to "## Embedded checkout (image detail page and cart)", and in its first paragraph change "the two image-detail tests fail" to "all three tests fail".
- In "Troubleshooting", the last bullet: "An image-detail test times out…" becomes "A test times out waiting for the embedded form, or lands on Stripe's hosted page: …" (the rest of the bullet unchanged).
- Add one bullet to "Troubleshooting":

```md
- The cart test fails at "toHaveCount(2)" on `checkout-preview`: `/checkout`
  rendered a different number of review rows than the cart had lines. Read
  the order's `order_item` rows before suspecting the selectors.
```

- [ ] **Step 6: Workflow comments**

`.github/workflows/stripe-e2e.yml`, comments only, no key or step changes:
- `:6-8`: "it pays through Stripe's real test checkout (the cart through the hosted page; the image detail page, once from an old /preview link, through Embedded Checkout on our /checkout page)" becomes "it pays through Stripe's real test checkout, always through Embedded Checkout on our /checkout page (the cart, the image detail page, and the image detail page entered from an old /preview link)".
- `:41-45`: "Purchases from the image detail page open Embedded Checkout…" becomes "Purchases from the image detail page and from the cart open Embedded Checkout on our own /checkout page, which is how production sells (EMBEDDED_CHECKOUT_ENABLED is on there). All three tests fail if the switch is off."

- [ ] **Step 7: `CLAUDE.md` standing lines and the old plan**

Edit only these three lines of `CLAUDE.md`. "Current state" is updated after the merge (Task 9), not here.

- Routes (`:80`): the `/checkout?session=` line becomes
  `/checkout?session=      → Stripe Embedded Checkout for purchases from the image detail page and the cart; 404 unless EMBEDDED_CHECKOUT_ENABLED (or the unused PREVIEW_EMBEDDED_CHECKOUT_ENABLED) is on (#250, #135, #278 slice 6b)`
- Key integration points, the Stripe bullet (`:132`): replace only the sentence `The cart stays hosted.` with `The cart uses the same switch and the same fallback (#278 slice 6b), so that one switch turns embedded checkout off for both.` Leave every other sentence of the bullet as it is.
- Environment Variables (`:171`): the comment after `EMBEDDED_CHECKOUT_ENABLED, PREVIEW_EMBEDDED_CHECKOUT_ENABLED` becomes `# embedded checkout for the image detail page and the cart (ON in prod; one switch for both); PREVIEW_EMBEDDED_CHECKOUT_ENABLED has no caller since slice 4, removed in slice 6a`

In `docs/superpowers/plans/2026-10-01-one-buy-surface.md`, directly under the bullet at `:984` that begins "Cart on embedded checkout (#135 slice 4)", add:

```md
  - Superseded 2026-10-10: the cart does not go through `createStripeCheckoutForOrder` (it builds its own session in `checkoutCart`), and by Nico's decision it gets no switch of its own. See `docs/superpowers/specs/2026-10-10-cart-embedded-checkout.md` and `docs/superpowers/plans/2026-10-10-cart-embedded-checkout.md`.
```

- [ ] **Step 8: Commit**

```bash
git add e2e/stripe-money-path.spec.ts docs/stripe-e2e.md .github/workflows/stripe-e2e.yml CLAUDE.md docs/superpowers/plans/2026-10-01-one-buy-surface.md
git commit -m "Stripe e2e: the cart pays through the embedded form; docs (#278 slice 6b)"
```

---

### Task 6: Gate, whole-branch review, HOLD pull request

Run by the controlling session, not an implementer.

- [ ] **Step 1: Combined tree.** `git fetch origin`; if main has moved, merge it into the branch and `npm ci`.
- [ ] **Step 2: Gate.** `npm run lint && npm run typecheck && npm test && npm run build` (build env: the dummy block in `ci.yml`'s `check` job). `npm run db:generate` must print "No schema changes" and leave `drizzle/` untouched. Then `npm run e2e`; if the worktree has no local database env, say so in the PR body and rely on the PR's own `e2e` job, which runs the same suite on an ephemeral Turso branch.
- [ ] **Step 3: Whole-branch review.** One independent Opus review of `git diff origin/main...HEAD` with the spec, this plan's Global Constraints and Review Focus. Do not tell it what not to flag. Fix rounds go back to the task's implementer; re-run the gate after each.
- [ ] **Step 4: Push and open the PR.** Title: `HOLD: Cart on embedded checkout (#278 slice 6b, #135 slice 4)`. The body leads with:

```md
## HOLD until all three have passed on this PR's final commit

- [ ] Stripe e2e workflow dispatched on this branch is green (run link, commit)
- [ ] Adversarial money-path review posted here; every finding fixed or ruled on
- [ ] Nico's smoke on the Preview deployment passed (commit)

Merging makes this live in Production at once: the cart rides
`EMBEDDED_CHECKOUT_ENABLED`, which is on there. That switch is the one kill
switch for the image detail page and the cart together. The narrower rollback
is reverting this PR.
```

then: what changed; Nico's nine decisions (link the spec); Claude's three rulings with their cost (compact review rows; the `catch` wraps the action call only; `/order/confirm`'s resume link left without `from`); the "Known limits" section below; the open questions; that no automated test pays through hosted checkout after this; and that no migration is involved. End the body with the attribution lines the session's instructions give.
- [ ] **Step 5: Post the whole-branch review** and its rulings as a PR comment.
- [ ] **Step 6: Check the PR was not merged early** (`gh pr view --json state,title,mergedAt`). It has happened to HOLD PRs three times. If it is merged, run Tasks 7 and 8 at once against main and tell Nico; the kill switch and the revert are the fallbacks.

---

### Task 7: Adversarial money-path review

Run by the controlling session: one Opus reviewer with no stake in the implementation, given the diff, the spec, and the brief below word for word. Its report is posted on the PR as a comment. Each finding is then fixed (back to the implementer, re-gate) or ruled on in a PR comment that says why. Copy the findings and rulings into the ledger.

```text
You are reviewing a change to how a multi-item cart is paid for. Assume the
change is wrong somewhere and find where. You are not asked to confirm it.

The change: checkoutCart (src/app/cart/actions.ts) now creates a Stripe
Embedded Checkout session when EMBEDDED_CHECKOUT_ENABLED is on and the key
pair is usable, and returns /checkout?session=<id>&from=%2Fcart; otherwise it
creates the hosted session it always did. buildCartCheckoutSessionParams
(src/lib/checkout.ts) gained a uiMode. The cart page catches a thrown action.
/checkout renders several order lines.

Rulings already made by the owner. They are context, not limits on what you
may report:
- The cart shares the image detail page's switch; no switch of its own.
- A bad key pair falls back to hosted checkout with a console.error.
- checkoutCart and createStripeCheckoutForOrder stay two separate paths.
- return_url uses the deployment's own origin (resolveReturnOrigin).
- Back on /checkout goes to /cart for a cart session.
- Shipping stays the amount quoted at cart time, as one fixed shipping option.
- Each Checkout click creates a new pending order and session and leaves the
  earlier session payable until it expires; a follow-up issue covers that.

Read src/app/cart/actions.ts, src/lib/checkout.ts, src/lib/embedded-checkout.ts,
src/lib/embedded-checkout-session.ts, src/app/checkout/**, src/app/cart/page.tsx,
src/lib/webhook-handlers.ts, src/lib/cart-line-match.ts,
src/app/order/confirm/page.tsx and src/lib/checkout-session-status.ts in full,
not only the diff. Run the tests you need. For each vector below, trace what
is written to order, order_item, cart_item and ledger_entry, what Stripe is
told, what the buyer is charged and what Printful would be sent. Report what
you verified as well as what you found.

1. Paying an earlier session after starting a new one. Checkout (session A),
   Back, change the cart, Checkout (session B), pay B, then open
   /checkout?session=A&from=%2Fcart from browser history. Does the form mount?
   Pay A too. How many orders are paid, what does each contain, what does the
   cart cleanup delete each time, is anything submitted to Printful twice?
   Is this any easier to reach than it was with hosted checkout?
2. A cart changed between session creation and payment: a quantity change, a
   size change, a removed line, a line added, in another tab. What is charged,
   what is in order_item, what stays in the cart after the webhook?
3. Quantity above one. Stripe line quantity and unit amount, the order's
   subtotal and total, shipping charged once, the review block's count, the
   webhook's cart cleanup, the shipping fallback when the Printful quote fails.
4. A line that became unavailable: before Checkout (refusal, nothing written)
   and after the session exists (an admin hides the image while the session is
   open). Can the hidden image still be paid for and printed? Is that new?
5. A foreign user, an anonymous session and a signed-out visitor opening
   /checkout?session=<a cart session>. Is the client secret ever in the
   response? A session id from the other Stripe mode. An order whose
   stripe_session_id was never saved.
6. The open-redirect surface of `from`: values such as //host, /\host, a path
   with control characters, an absolute URL, an array, a very long value;
   the sign-in round trip built from it; whether a client can influence the
   `from` that checkoutCart itself emits.
7. The fallback path. Switch on with the publishable key missing, malformed,
   or in the other mode. A publishable key of the right mode from a different
   Stripe account (the config check passes; what does the buyer see?). The
   switch turned off while an embedded session is open. Does any log line
   carry key material?
8. The origin in return_url. A forged Origin header on the server action. A
   host that matches the preview pattern but is not this project's deployment
   (consider what Vercel hostnames another account can create). What stops a
   live session's return_url from pointing somewhere the owner does not
   control, and is that the same guard in Production and on a Preview?
9. Ordering inside checkoutCart. Is there any new statement between the
   order insert and the Stripe call that can throw and leave a pending order
   that is neither abandoned nor attached to a session? What happens when
   saving stripe_session_id fails after Stripe succeeded?
10. Concurrency: two checkoutCart calls at once, a double tap on Checkout,
    Checkout in two tabs.
11. Hosted regression. With the switch off, are the Stripe params, the
    returned URL and the rows identical to before this change? Which test
    proves it, and is that proof independent of the code under test?
12. Promotion codes and totals in an embedded cart session: what the webhook
    reconciles, and whether anything of ours on /checkout shows a number that
    a promotion code could make wrong.
13. A delayed payment method in a cart session: session complete but unpaid,
    then succeeded or failed. What /order/confirm and /checkout show.
14. Anything else in the money path that this change touches or newly
    exposes, including tests that would pass with the feature broken.

For each finding give: the scenario, the exact file and line, what happens,
what should happen, and how sure you are. Separate what is new with this
change from what already existed on main.
```

---

### Task 8: Dispatched Stripe e2e on the branch, Nico's Preview smoke, lift HOLD

Run by the controlling session. All three gates must be taken on the PR's final commit. A code commit after a gate reopens gates 1 and 3; a docs-only commit does not.

- [ ] **Step 1: Dispatch the workflow on the branch.**

```bash
gh workflow run stripe-e2e.yml --ref claude/cart-embedded-checkout
gh run list --workflow stripe-e2e.yml --branch claude/cart-embedded-checkout --limit 1 --json databaseId,headSha,status,url
gh run watch "$(gh run list --workflow stripe-e2e.yml --branch claude/cart-embedded-checkout --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
```

Give the dispatch a few seconds before listing: the run does not exist the instant `gh workflow run` returns. Check that the listed run's `headSha` is the branch head. The workflow queues behind a nightly that is still running (its concurrency group does not cancel). Expect the first run to need a fix: Stripe's embedded DOM has needed calibration before (#270). On red, download the traces (`gh run download` with that run's id and `-n stripe-e2e-playwright-traces`), fix the spec (or the product code, if the failure is real), push, and dispatch again. A red dispatched run also opens or comments on the `stripe-e2e-nightly` issue; once the branch run is green, comment there that those failures were branch runs of this PR, and close the issue if nothing from main is on it.

Record the green run's URL and commit in the PR body's first checkbox.

- [ ] **Step 2: Confirm the Preview can run the smoke.** The Preview scope needs `EMBEDDED_CHECKOUT_ENABLED`, a test-mode `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `PRINTFUL_DRY_RUN` and `CART_ENABLED`. The first four were set for the 2026-09-28 phone test (`CLAUDE.md`, Current state); `CART_ENABLED` in the Preview scope is not recorded anywhere (open question 5). Check names only with `vercel env ls preview` from the linked checkout. If one is missing, that is Nico's change in the Vercel dashboard; after it, push a commit (an empty one will do) because a Preview only builds on a push, and wait for that build before sending the smoke.
- [ ] **Step 3: Confirm the Preview URL.** The expected branch URL is `https://prntd-git-claude-cart-embedded-checkout-nico-lovejoys-projects.vercel.app`. Read the real one from the Vercel bot's comment on the PR and use that in the smoke if it differs. It must match the preview host pattern in `src/lib/embedded-checkout.ts` (`prntd-…-nico-lovejoys-projects.vercel.app`), or the purchase returns to prntd.org and the smoke fails for a reason that is not the code.
- [ ] **Step 4: Send the smoke to Nico**, in a message of its own, written out in full as below (with the confirmed URL).

```text
Smoke: paying for a two-shirt cart stays on the Preview

Where: https://prntd-git-claude-cart-embedded-checkout-nico-lovejoys-projects.vercel.app
A desktop browser at phone width is fine. Stripe is in test mode on this
Preview: no real money moves and nothing is printed.

Before the steps:
A. Sign in on the Preview. Its accounts are separate from prntd.org's, so if
   sign-in is refused, sign up there with any email.
B. The Preview has an empty Shop, so you need two designs of your own. Open
   https://prntd-git-claude-cart-embedded-checkout-nico-lovejoys-projects.vercel.app/studio
   If it already shows two results, use those. If not, generate two, one at a
   time: "smoke heron reading a newspaper", then "smoke anvil with wings".
   Wait until both have a result.

Steps:
1. In the Studio, tap the first result, tap Order, pick size M, tap
   Add to cart. You land on the cart with one line.
2. Open
   https://prntd-git-claude-cart-embedded-checkout-nico-lovejoys-projects.vercel.app/studio
   again, tap the second result, tap Order, pick size L, tap Add to cart. The
   cart shows two lines.
3. Tap Checkout.
4. In the payment form enter any email, card 4242 4242 4242 4242, any future
   expiry, any CVC, any name, any US address, and tap Pay.

PASS, both:
- After step 3 the address bar is still on the Preview host and its path
  starts with /checkout?session=cs_test_ . The page shows "← Back", two
  shirts (one M, one L) with no price beside them, and a payment form.
- After step 4 the address bar is on the same Preview host at /order/confirm
  and the page says "Order confirmed." with rows "Item 1" and "Item 2".

FAIL, any one:
- After step 3 the address bar shows checkout.stripe.com.
- After step 3 the cart shows "Couldn't start checkout. Nothing was charged."
- The checkout page shows one shirt only, or a price in our own list on the
  left or top (prices inside Stripe's form are expected).
- After step 4 the address bar is on prntd.org, or the page says
  "Order not found." or "Payment not completed."
- If the image detail page has no Add to cart button at step 1, stop and
  tell me: the Preview is missing a setting, and that is not a result.

Expected on a Preview, not failures: afterwards the cart still shows both
lines, no email arrives, and Orders does not list the order. A Preview gets
no Stripe webhook, so the order stays pending there.
```

- [ ] **Step 5: Lift HOLD.** When the run is green, the adversarial findings are closed on the PR and the smoke has passed, all on the same final commit: tick the three boxes with their evidence, remove `HOLD:` from the title, and tell Nico it is ready to merge. Say again in that message that the merge makes it live in Production at once.

---

### Task 9: Close

Run by the controlling session.

- [ ] **Step 1: Open the follow-up issue** (decision 7). Write the text below to `expire-earlier-session.md` in the session's scratch directory (not in the repo) and run the command from there:

```bash
gh issue create --title "Checkout: expire the earlier Stripe session when a new one is created" --body-file expire-earlier-session.md
```

```md
Every Checkout or Order click creates a new pending order and a new Stripe
Checkout session, and leaves the earlier session payable until it expires
(two hours). This holds for the cart (`checkoutCart`) and for the image
detail page (`createStripeCheckoutForOrder`). #278 slice 6b put the cart on
embedded checkout and left this unchanged on purpose.

What can go wrong today:

- A buyer starts checkout, goes back, changes the cart, checks out again and
  pays. The first session is still open and its page is in the browser's
  history (`/checkout?session=<old>&from=/cart`, or the hosted Stripe URL).
  Opening it mounts a live payment form for the old cart; paying it creates a
  second paid order.
- A double tap on Checkout creates two orders and two sessions. The cart
  page's button returns to its idle label as soon as the navigation has been
  requested, so there is a moment in which a second tap goes through.
- Each abandoned attempt leaves a pending order until Stripe's
  `checkout.session.expired` marks it abandoned.

Proposal to discuss: when a new session has been created for a buyer, expire
that buyer's other open sessions for still-pending, not-abandoned orders
(`stripe.checkout.sessions.expire`), after the new session exists and never
before, ignoring failures (a session being paid at that moment cannot be
expired and must be left alone). The existing `checkout.session.expired`
webhook then marks those orders abandoned. Also keep the cart's Checkout
button disabled until the page unloads, and reset it on a back/forward-cache
restore, as the image detail page's Order button already does.

Money path: needs real-DB tests and an adversarial review. Pinned today by
"each Checkout makes its own order and session" in
`src/app/cart/__tests__/checkout-cart-embedded.integration.test.ts`.
```

- [ ] **Step 2: Ledger.** Copy the SDD ledger (per-task results, review findings, rulings, the dispatched run links, the smoke result) to `docs/superpowers/ledgers/2026-10-10-cart-embedded-checkout.md` before removing the worktree.
- [ ] **Step 3: After Nico merges.**
  - The `prod-smoke` workflow for the merge commit is green (`gh run list --workflow prod-smoke.yml --limit 1`).
  - The next scheduled `stripe-e2e.yml` run on main (08:23 UTC) is green. It is the first run of the new cart test on main.
  - For the first day, look for the line `embedded checkout disabled for the cart:` in `vercel logs prntd.org` and for cart-shaped errors on https://prntd.org/admin/errors. Either one means the cart is falling back to hosted or failing.
  - Update `CLAUDE.md` "Current state" (prod commit, this slice merged, the follow-up issue, #135 slice 4 done, slice 6a still gated) in a docs commit, and comment on #278 and #135.
- [ ] **Step 4: If Nico answers yes to open question 1**, send him this as its own message. It is a real purchase: it is charged, printed and shipped unless he cancels the order.

```text
Smoke: a real two-shirt cart purchase on prntd.org

Where: https://prntd.org , signed in as yourself. This is a real order with
your real card. It is printed and shipped unless you cancel it.

Steps:
1. Open https://prntd.org/designs , open a design, tap Order, pick a size,
   tap Add to cart.
2. Open https://prntd.org/designs again, open a different design, tap Order,
   pick a size, tap Add to cart. The cart at https://prntd.org/cart shows two
   lines.
3. Tap Checkout and pay.
4. Open https://prntd.org/cart

PASS, all three:
- After tapping Checkout the address bar stays on prntd.org at
  /checkout?session=cs_live_ and the page shows both shirts and a payment
  form.
- After paying, the address bar is on https://prntd.org/order/confirm and the
  page says "Order confirmed." with rows "Item 1" and "Item 2".
- At step 4 the cart says "Your cart is empty."

FAIL, any one:
- The address bar shows checkout.stripe.com at any point.
- "Order not found." or "Payment not completed." after paying.
- At step 4, a minute after paying, the cart still shows the two lines.
```

## Known limits (state them in the PR)

- Each Checkout click makes a new pending order and session; the earlier session stays payable until it expires (decision 7; follow-up issue in Task 9). The cart's button becomes active again as soon as navigation is requested, so a double tap makes two orders.
- `/order/confirm`'s "Return to checkout" link carries no `from`, so Back on a resumed cart checkout goes to the Shop (ruling in the spec; the image detail page has the same gap).
- On a phone a long cart puts many review rows above the payment form. They are not collapsed.
- Two lines of the same garment have "View larger" buttons with the same accessible name (open question 3).
- After this slice no automated test pays through Stripe's hosted page. Hosted is the fallback and is covered by parameter tests only.
- Turning `EMBEDDED_CHECKOUT_ENABLED` off strands embedded sessions that are open at that moment: `/checkout` 404s and an embedded session has no hosted URL. Their orders expire; the carts are intact.
- Embedded Checkout can re-quote shipping from the buyer's address. This slice does not use that; shipping is still the amount quoted at cart time (decision 6).
- A purchase on a Preview deployment gets no webhook: the order stays pending, the cart is not emptied, no email is sent.

## Open questions for Nico

1. **A real two-item purchase on prntd.org after the merge, as you did for the image detail page?** Recommendation: do it once, the next time you want two shirts anyway, and not as a merge gate. Before merge the evidence is the Stripe e2e on the branch (test mode, real webhook, cart emptied) and your Preview smoke. What only Production can show is the live key pair creating a multi-line embedded session, and the image detail page has created embedded sessions with that pair since 2026-09-29. The smoke is drafted in Task 9.
2. **`/checkout` on a laptop with several lines: compact rows instead of one large square per line?** Recommendation: yes, compact rows (a 96px tile beside the text, the layout phones already use). It is built that way as a ruling; a single-line order keeps the large square. Reverting is one prop.
3. **Should the "View larger" buttons say which line they belong to?** Two lines of the same garment are both named `View larger: Classic Tee` for a screen reader. Recommendation: yes, as `View larger: <product>, <colour> / <size>`, in a small PR after this one. It is new wording, so it is not built here.
4. **`/order/confirm`'s "Return to checkout" leads to a checkout page whose Back goes to the Shop, for a cart session too.** Recommendation: leave it in this slice and fix it for both surfaces together by carrying `from` on Stripe's `return_url`. Do you want an issue opened for that?
5. **Is `CART_ENABLED=true` set in Vercel's Preview scope?** The Preview smoke needs the Add to cart button, which that flag shows. Recommendation: if `vercel env ls preview` does not list it, add it in the dashboard (Preview scope) and tell Claude, who then pushes a commit so the Preview rebuilds.
