/**
 * createCheckoutSession's embedded-checkout wiring (#135 slice 3) against a
 * real in-memory libSQL (the buy-published-design-embedded pattern). Both
 * flags off is today's hosted session byte for byte; EMBEDDED_CHECKOUT_ENABLED
 * alone changes nothing here; PREVIEW_EMBEDDED_CHECKOUT_ENABLED with a valid
 * key pair produces an embedded session and the /checkout redirect back to
 * the same /preview picks; a key problem degrades to hosted with a
 * console.error naming why.
 *
 * The db singleton, auth session, and Stripe client are mocked; the database
 * is real (FKs enforced, schema-derived).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import { buildCheckoutSessionParams } from "@/lib/checkout";
import { resolveOrderVariant } from "@/lib/blanks";

const h = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
  sessionParams: [] as Stripe.Checkout.SessionCreateParams[],
  rowsAtCreateTime: [] as { orders: unknown[]; items: unknown[] }[],
  originHeader: null as string | null,
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

vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(async (params: Stripe.Checkout.SessionCreateParams) => {
          h.sessionParams.push(params);
          const db = h.db as Awaited<ReturnType<typeof createTestDb>>;
          h.rowsAtCreateTime.push({
            orders: await db.select().from(schema.order),
            items: await db.select().from(schema.orderItem),
          });
          return {
            id: `cs_test_${h.sessionParams.length}`,
            url: "https://checkout.stripe.example/cs_test_hosted",
          };
        }),
      },
    },
  },
}));

import { createCheckoutSession } from "@/app/order/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };
const PRIMARY_URL = "https://img.example/primary.png";
const PREVIEW_HOST = "https://prntd-git-foo-nico-lovejoys-projects.vercel.app";

async function seed(db: Db) {
  await makeUser(db, "nico");
  const design = await makeDesign(db, "nico");
  const primaryId = await makeSourceImage(db, {
    designId: design.id,
    ownerId: "nico",
    imageUrl: PRIMARY_URL,
  });
  await db
    .update(schema.design)
    .set({ primaryImageId: primaryId })
    .where(eq(schema.design.id, design.id));
  return { designId: design.id, primaryId };
}

/** The hosted params today's code builds, from the persisted order row. */
async function expectedHostedParams(
  db: Db,
  cancelUrl: string
): Promise<Stripe.Checkout.SessionCreateParams> {
  const [order] = await db.select().from(schema.order);
  if (order.itemPrice == null || order.shippingPrice == null) {
    throw new Error("expected itemPrice/shippingPrice to be persisted");
  }
  const { product } = resolveOrderVariant(OPTS);
  return buildCheckoutSessionParams({
    orderId: order.id,
    designId: order.designId,
    productName: product.name,
    color: OPTS.color,
    size: OPTS.size,
    itemPrice: order.itemPrice,
    shippingPrice: order.shippingPrice,
    imageUrl: PRIMARY_URL,
    cancelUrl,
    appUrl: "http://localhost:3000",
  });
}

function enablePreviewEmbedded() {
  vi.stubEnv("PREVIEW_EMBEDDED_CHECKOUT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_abc123");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc123");
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = { user: { id: "nico", isAnonymous: false } };
  h.sessionParams = [];
  h.rowsAtCreateTime = [];
  h.originHeader = null;
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "false");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", undefined);
  vi.stubEnv("PREVIEW_EMBEDDED_CHECKOUT_ENABLED", undefined);
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", undefined);
  vi.stubEnv("STRIPE_SECRET_KEY", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("createCheckoutSession embedded-checkout gating (#135 slice 3)", () => {
  it("both flags off: hosted params and cancel_url exactly as before, whatever the Origin", async () => {
    h.originHeader = PREVIEW_HOST;
    const db = h.db as Db;
    const ids = await seed(db);

    const { url } = await createCheckoutSession({
      designId: ids.designId,
      ...OPTS,
    });

    expect(url).toBe("https://checkout.stripe.example/cs_test_hosted");
    const cancelUrl = `http://localhost:3000/preview?id=${ids.designId}&size=M&color=Black&product=bella-canvas-3001`;
    const expected = await expectedHostedParams(db, cancelUrl);
    const [params] = h.sessionParams;
    expect(params).toEqual({ ...expected, expires_at: expect.any(Number) });
    expect(params.cancel_url).toBe(cancelUrl);
    expect(params).not.toHaveProperty("ui_mode");
    expect(params).not.toHaveProperty("return_url");
  });

  it("only EMBEDDED_CHECKOUT_ENABLED on with a valid pair: still hosted", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_abc123");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc123");
    const db = h.db as Db;
    const ids = await seed(db);

    const { url } = await createCheckoutSession({
      designId: ids.designId,
      ...OPTS,
    });

    expect(url).toBe("https://checkout.stripe.example/cs_test_hosted");
    const [params] = h.sessionParams;
    expect(params).not.toHaveProperty("ui_mode");
    expect(params.success_url).toContain("/order/confirm?session_id=");
    expect(params.cancel_url).toBe(
      `http://localhost:3000/preview?id=${ids.designId}&size=M&color=Black&product=bella-canvas-3001`
    );
  });

  it("preview flag on + valid pk_test_/sk_test_ pair: embedded params and the /checkout redirect", async () => {
    enablePreviewEmbedded();
    const db = h.db as Db;
    const ids = await seed(db);

    const { url } = await createCheckoutSession({
      designId: ids.designId,
      ...OPTS,
    });

    const [params] = h.sessionParams;
    expect((params as { ui_mode?: string }).ui_mode).toBe("embedded");
    expect(params.return_url).toBe(
      "http://localhost:3000/order/confirm?session_id={CHECKOUT_SESSION_ID}"
    );
    expect(params).not.toHaveProperty("success_url");
    expect(params).not.toHaveProperty("cancel_url");
    const from = `/preview?id=${ids.designId}&size=M&color=Black&product=bella-canvas-3001`;
    expect(url).toBe(
      `/checkout?session=cs_test_1&from=${encodeURIComponent(from)}`
    );
  });

  it("preview flag on: the back path carries the front and back picks", async () => {
    enablePreviewEmbedded();
    vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
    const db = h.db as Db;
    const ids = await seed(db);
    const otherFront = await makeSourceImage(db, {
      designId: ids.designId,
      ownerId: "nico",
      imageUrl: "https://img.example/other-front.png",
    });
    const backId = await makeSourceImage(db, {
      designId: ids.designId,
      ownerId: "nico",
      imageUrl: "https://img.example/back.png",
    });

    const { url } = await createCheckoutSession({
      designId: ids.designId,
      ...OPTS,
      front: otherFront,
      back: backId,
    });

    const from = `/preview?id=${ids.designId}&size=M&color=Black&product=bella-canvas-3001&front=${otherFront}&back=${backId}`;
    expect(url).toBe(
      `/checkout?session=cs_test_1&from=${encodeURIComponent(from)}`
    );
    const [line] = await db.select().from(schema.orderItem);
    expect(line.placements).toEqual({ front: otherFront, back: backId });
  });

  it("preview flag on: the order + order_item rows exist before Stripe is called, and stripeSessionId is persisted after", async () => {
    enablePreviewEmbedded();
    const db = h.db as Db;
    const ids = await seed(db);

    await createCheckoutSession({ designId: ids.designId, ...OPTS });

    expect(h.rowsAtCreateTime[0].orders).toHaveLength(1);
    expect(h.rowsAtCreateTime[0].items).toHaveLength(1);
    const [order] = await db.select().from(schema.order);
    expect(order.stripeSessionId).toBe("cs_test_1");
    const [line] = await db.select().from(schema.orderItem);
    expect(line.placements).toEqual({ front: ids.primaryId });
  });

  it("preview flag on + missing key: hosted params + url, console.error names missing-key", async () => {
    vi.stubEnv("PREVIEW_EMBEDDED_CHECKOUT_ENABLED", "true");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc123");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = h.db as Db;
    const ids = await seed(db);

    const { url } = await createCheckoutSession({
      designId: ids.designId,
      ...OPTS,
    });

    expect(url).toBe("https://checkout.stripe.example/cs_test_hosted");
    const expected = await expectedHostedParams(
      db,
      `http://localhost:3000/preview?id=${ids.designId}&size=M&color=Black&product=bella-canvas-3001`
    );
    expect(h.sessionParams[0]).toEqual({
      ...expected,
      expires_at: expect.any(Number),
    });
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("missing-key"));
  });

  it("preview flag on + pk_live_ with sk_test_ (mode-mismatch): hosted params + url, console.error names mode-mismatch", async () => {
    vi.stubEnv("PREVIEW_EMBEDDED_CHECKOUT_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_live_abc123");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc123");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = h.db as Db;
    const ids = await seed(db);

    const { url } = await createCheckoutSession({
      designId: ids.designId,
      ...OPTS,
    });

    expect(url).toBe("https://checkout.stripe.example/cs_test_hosted");
    const expected = await expectedHostedParams(
      db,
      `http://localhost:3000/preview?id=${ids.designId}&size=M&color=Black&product=bella-canvas-3001`
    );
    expect(h.sessionParams[0]).toEqual({
      ...expected,
      expires_at: expect.any(Number),
    });
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("mode-mismatch")
    );
  });

  it("preview flag on: return_url follows a trusted preview Origin", async () => {
    enablePreviewEmbedded();
    h.originHeader = PREVIEW_HOST;
    const db = h.db as Db;
    const ids = await seed(db);

    await createCheckoutSession({ designId: ids.designId, ...OPTS });

    expect(h.sessionParams[0].return_url).toBe(
      `${PREVIEW_HOST}/order/confirm?session_id={CHECKOUT_SESSION_ID}`
    );
  });

  it("preview flag on: return_url falls back to NEXT_PUBLIC_APP_URL for an untrusted Origin", async () => {
    enablePreviewEmbedded();
    h.originHeader = "https://evil.example";
    const db = h.db as Db;
    const ids = await seed(db);

    await createCheckoutSession({ designId: ids.designId, ...OPTS });

    expect(h.sessionParams[0].return_url).toBe(
      "http://localhost:3000/order/confirm?session_id={CHECKOUT_SESSION_ID}"
    );
  });

  it("preview flag on: a guest still gets needsAuth and no order row", async () => {
    enablePreviewEmbedded();
    h.session = { user: { id: "guest", isAnonymous: true } };
    const db = h.db as Db;
    const ids = await seed(db);

    const result = await createCheckoutSession({
      designId: ids.designId,
      ...OPTS,
    });

    expect(result).toEqual({ url: null, needsAuth: true });
    expect(h.sessionParams).toHaveLength(0);
    expect(await db.select().from(schema.order)).toHaveLength(0);
  });
});
