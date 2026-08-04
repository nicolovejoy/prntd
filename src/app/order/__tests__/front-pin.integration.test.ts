/**
 * Explicit front-placement pin on the design-your-own flow (#138, slice 1)
 * against a real in-memory libSQL (the #28 pattern). Proves:
 *
 *  - with no `front`, the order still pins the design's primary image and the
 *    Stripe line thumbnail is still the design's display image (unchanged);
 *  - `front` pins that exact image into `order_item.placements` / the cart
 *    line, and the Stripe thumbnail follows the pin;
 *  - the pin clears the SAME guard the back does (canUseAsPlacementSource):
 *    the caller's own image passes, a published Shop image passes, a
 *    cross-owner private or admin-hidden id throws and no order row is
 *    written;
 *  - a front pin grants no reach a back pin didn't already have;
 *  - front + back coexist and the +$8 back upcharge is the only price effect.
 *
 * The db singleton, auth session and Stripe are mocked; the database is real
 * (FKs enforced, schema-derived).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import { BACK_PLACEMENT_UPCHARGE, computePrice } from "@/lib/pricing";

const h = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
  sessionParams: [] as Stripe.Checkout.SessionCreateParams[],
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

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(async (params: Stripe.Checkout.SessionCreateParams) => {
          h.sessionParams.push(params);
          return {
            id: `cs_test_${h.sessionParams.length}`,
            url: "https://checkout.stripe.example/cs_test",
          };
        }),
      },
    },
  },
}));

// Cart shipping falls back to the flat estimate (no live Printful quote).
vi.mock("@/lib/printful", () => ({
  estimateOrderCosts: vi.fn(async () => null),
}));

import { createCheckoutSession } from "@/app/order/actions";
import { addToCart } from "@/app/cart/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };

async function seed(db: Db) {
  await makeUser(db, "nico");
  await makeUser(db, "seller");

  // The buyer's own thread: a primary plus a sibling generation they might
  // prefer on the front.
  const mine = await makeDesign(db, "nico");
  const primaryId = await makeSourceImage(db, {
    designId: mine.id,
    ownerId: "nico",
    imageUrl: "https://img.example/primary.png",
  });
  const siblingId = await makeSourceImage(db, {
    designId: mine.id,
    ownerId: "nico",
    imageUrl: "https://img.example/sibling.png",
  });
  await db
    .update(schema.design)
    .set({ primaryImageId: primaryId })
    .where(eq(schema.design.id, mine.id));

  // A stranger's design: one published image (Shop), one private, one hidden.
  const theirs = await makeDesign(db, "seller");
  const publishedId = await makeSourceImage(db, {
    designId: theirs.id,
    ownerId: "seller",
    imageUrl: "https://img.example/shop.png",
    publishedAt: new Date(),
  });
  const privateId = await makeSourceImage(db, {
    designId: theirs.id,
    ownerId: "seller",
    imageUrl: "https://img.example/private.png",
  });
  const hiddenId = await makeSourceImage(db, {
    designId: theirs.id,
    ownerId: "seller",
    imageUrl: "https://img.example/hidden.png",
    publishedAt: new Date(),
    isHidden: true,
  });

  return {
    designId: mine.id,
    primaryId,
    siblingId,
    publishedId,
    privateId,
    hiddenId,
  };
}

async function orderLines(db: Db) {
  return db.query.orderItem.findMany();
}

function lastLineImages(): string[] {
  const params = h.sessionParams[h.sessionParams.length - 1];
  const first = params?.line_items?.[0];
  return first?.price_data?.product_data?.images ?? [];
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = { user: { id: "nico", isAnonymous: false } };
  h.sessionParams = [];
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createCheckoutSession front pin (#138)", () => {
  it("without `front`, still pins the design's primary image", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await createCheckoutSession({ designId: ids.designId, ...OPTS });

    const [line] = await orderLines(db);
    expect(line.placements).toEqual({ front: ids.primaryId });
    expect(lastLineImages()).toEqual(["https://img.example/primary.png"]);
  });

  it("pins an explicit front pick and follows it for the Stripe thumbnail", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await createCheckoutSession({
      designId: ids.designId,
      front: ids.siblingId,
      ...OPTS,
    });

    const [line] = await orderLines(db);
    expect(line.placements).toEqual({ front: ids.siblingId });
    expect(line.placements?.front).not.toBe(ids.primaryId);
    expect(lastLineImages()).toEqual(["https://img.example/sibling.png"]);
  });

  it("allows a published Shop image as the front (same grant as the back)", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await createCheckoutSession({
      designId: ids.designId,
      front: ids.publishedId,
      ...OPTS,
    });

    const [line] = await orderLines(db);
    expect(line.placements).toEqual({ front: ids.publishedId });
  });

  it("rejects a cross-owner private image and writes no order", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await expect(
      createCheckoutSession({
        designId: ids.designId,
        front: ids.privateId,
        ...OPTS,
      })
    ).rejects.toThrow("Front image is not available");

    expect(await orderLines(db)).toHaveLength(0);
    expect(await db.query.order.findMany()).toHaveLength(0);
    expect(h.sessionParams).toHaveLength(0);
  });

  it("rejects a cross-owner admin-hidden image", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await expect(
      createCheckoutSession({
        designId: ids.designId,
        front: ids.hiddenId,
        ...OPTS,
      })
    ).rejects.toThrow("Front image is not available");
    expect(await orderLines(db)).toHaveLength(0);
  });

  it("carries front + back together; only the back moves the price", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await createCheckoutSession({
      designId: ids.designId,
      front: ids.siblingId,
      back: ids.publishedId,
      ...OPTS,
    });

    const [line] = await orderLines(db);
    expect(line.placements).toEqual({
      front: ids.siblingId,
      back: ids.publishedId,
    });

    const front = computePrice(0, OPTS.productId, OPTS.size).total;
    expect(line.itemPrice).toBeCloseTo(front + BACK_PLACEMENT_UPCHARGE, 2);
  });

  it("round-trips the pick through the Stripe cancel URL", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await createCheckoutSession({
      designId: ids.designId,
      front: ids.siblingId,
      ...OPTS,
    });

    const params = h.sessionParams[0];
    expect(params.cancel_url).toContain(`front=${ids.siblingId}`);
  });
});

describe("addToCart front pin on the designId path (#138)", () => {
  it("pins an explicit front pick", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await addToCart({ designId: ids.designId, front: ids.siblingId, ...OPTS });

    const [row] = await db.query.cartItem.findMany();
    expect(row.designId).toBe(ids.designId);
    expect(row.placements).toEqual({ front: ids.siblingId });
  });

  it("falls back to the primary when no pick is sent", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await addToCart({ designId: ids.designId, ...OPTS });

    const [row] = await db.query.cartItem.findMany();
    expect(row.placements).toEqual({ front: ids.primaryId });
  });

  it("rejects a cross-owner private front pick and carts nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);

    await expect(
      addToCart({ designId: ids.designId, front: ids.privateId, ...OPTS })
    ).rejects.toThrow("Front image is not available");
    expect(await db.query.cartItem.findMany()).toHaveLength(0);
  });
});
