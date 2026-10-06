/**
 * A `placement_render` id used as a pin is judged by its SOURCE image (second
 * fix round, fix 1). A render resolves with isHidden false, publishedAt null
 * and its conversation's owner, so the guard used to grant it on ownership and
 * never looked at the image it was rendered from: a render of a hidden (or
 * since-unpublished) image could still be ordered. Now a render pin must also
 * pass the guard for its source image, for the same user, following render
 * chains; a render with no source, or whose source is gone, is refused.
 *
 * Every refusal asserts nothing was written and Stripe was not called. Prices
 * are not asserted. Real in-memory libSQL; db, session and Stripe mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import {
  makeUser,
  makeDesign,
  makeSourceImage,
  setPublication,
} from "@/lib/__tests__/factories";

const h = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
  stripeCalls: 0 as number,
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
        create: vi.fn(async () => {
          h.stripeCalls += 1;
          return { id: "cs_test_rp", url: "https://checkout.stripe.example/rp" };
        }),
      },
    },
  },
}));
vi.mock("@/lib/printful", () => ({
  estimateOrderCosts: vi.fn(async () => null),
}));
const mockupRender = vi.hoisted(() => ({
  renderAndCacheMockup: vi.fn(async () => ({ mockupUrl: "https://r2.example/m.jpg" })),
}));
vi.mock("@/lib/mockup-render", () => mockupRender);

import { buyPublishedDesign, getListingBackMockup, resolveInitialBack } from "@/app/d/actions";
import { addToCart, checkoutCart, getCart } from "@/app/cart/actions";
import { createCheckoutSession } from "@/app/order/actions";
import { cartLineStillValid } from "@/lib/cart-line-check";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };

async function makeRender(
  db: Db,
  designId: string,
  sourceImageId: string | null
): Promise<string> {
  const [r] = await db
    .insert(schema.placementRender)
    .values({
      designId,
      sourceImageId,
      blankId: OPTS.productId,
      placementId: "back",
      imageUrl: `https://img.example/render-${crypto.randomUUID()}.png`,
      aspectRatio: "1:1",
    })
    .returning();
  return r.id;
}

async function seed(db: Db) {
  await makeUser(db, "owner");
  await makeUser(db, "seller");
  const mine = await makeDesign(db, "owner");
  const goodId = await makeSourceImage(db, {
    designId: mine.id,
    ownerId: "owner",
    imageUrl: "https://img.example/good.png",
  });
  const hiddenId = await makeSourceImage(db, {
    designId: mine.id,
    ownerId: "owner",
    imageUrl: "https://img.example/hidden.png",
    publishedAt: new Date(),
    isHidden: true,
  });
  const sold = await makeDesign(db, "seller");
  const sellerPublishedId = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: "https://img.example/seller-published.png",
    publishedAt: new Date(),
  });
  return {
    myDesignId: mine.id,
    goodId,
    hiddenId,
    soldDesignId: sold.id,
    sellerPublishedId,
    renderOfHidden: await makeRender(db, mine.id, hiddenId),
    renderOfGood: await makeRender(db, mine.id, goodId),
    renderOfSellers: await makeRender(db, mine.id, sellerPublishedId),
  };
}

async function expectNothingWritten(db: Db) {
  expect(await db.select().from(schema.order)).toHaveLength(0);
  expect(await db.select().from(schema.orderItem)).toHaveLength(0);
  expect(await db.select().from(schema.cartItem)).toHaveLength(0);
  expect(h.stripeCalls).toBe(0);
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = { user: { id: "owner", isAnonymous: false } };
  h.stripeCalls = 0;
  mockupRender.renderAndCacheMockup.mockClear();
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
});
afterEach(() => vi.unstubAllEnvs());

describe("a render of a hidden image is refused as a pin", () => {
  it("createCheckoutSession front and back", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await expect(
      createCheckoutSession({ designId: ids.myDesignId, front: ids.renderOfHidden, ...OPTS })
    ).rejects.toThrow("Front image is not available");
    await expect(
      createCheckoutSession({
        designId: ids.myDesignId,
        front: ids.goodId,
        back: ids.renderOfHidden,
        ...OPTS,
      })
    ).rejects.toThrow("Back image is not available");
    await expectNothingWritten(db);
  });

  it("buyPublishedDesign back and swapped front", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await expect(
      buyPublishedDesign({ imageId: ids.goodId, backImageId: ids.renderOfHidden, ...OPTS })
    ).rejects.toThrow("Back image is not available");
    await expect(
      buyPublishedDesign({
        imageId: ids.goodId,
        frontImageId: ids.renderOfHidden,
        backImageId: ids.goodId,
        ...OPTS,
      })
    ).rejects.toThrow("Front image is not available");
    await expectNothingWritten(db);
  });

  it("addToCart front and back, both paths", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await expect(
      addToCart({ designId: ids.myDesignId, front: ids.renderOfHidden, ...OPTS })
    ).rejects.toThrow("Front image is not available");
    await expect(
      addToCart({ frontImageId: ids.goodId, back: ids.renderOfHidden, ...OPTS })
    ).rejects.toThrow("Back image is not available");
    await expectNothingWritten(db);
  });

  it("a line that already pins it is flagged and refuses checkout", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await db.insert(schema.cartItem).values({
      userId: "owner",
      designId: ids.myDesignId,
      productId: OPTS.productId,
      size: OPTS.size,
      color: OPTS.color,
      placements: { front: ids.renderOfHidden },
    });
    expect(
      await cartLineStillValid(
        {
          designId: ids.myDesignId,
          ...OPTS,
          placements: { front: ids.renderOfHidden },
        },
        "owner"
      )
    ).toBe(false);
    expect((await getCart()).items[0].unavailable).toBe(true);
    expect((await checkoutCart()).error).toBeTruthy();
    expect(await db.select().from(schema.order)).toHaveLength(0);
    expect(h.stripeCalls).toBe(0);
  });

  it("the back mockup and the link resolver refuse it", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await expect(
      getListingBackMockup({
        imageId: ids.goodId,
        backImageId: ids.renderOfHidden,
        productId: OPTS.productId,
        colorName: "Black",
      })
    ).rejects.toThrow("Back image is not available");
    expect(mockupRender.renderAndCacheMockup).not.toHaveBeenCalled();
    expect(await resolveInitialBack(ids.goodId, ids.renderOfHidden)).toBeNull();
  });
});

describe("a render whose source went away is refused", () => {
  it("a source that no longer exists, and a render with no source", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    const orphan = await makeRender(db, ids.myDesignId, "deleted-image");
    const sourceless = await makeRender(db, ids.myDesignId, null);
    for (const pin of [orphan, sourceless]) {
      await expect(
        addToCart({ designId: ids.myDesignId, front: pin, ...OPTS })
      ).rejects.toThrow("Front image is not available");
    }
    await expectNothingWritten(db);
  });

  it("a render of a render is judged down the chain", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    const chained = await makeRender(db, ids.myDesignId, ids.renderOfHidden);
    await expect(
      addToCart({ designId: ids.myDesignId, front: chained, ...OPTS })
    ).rejects.toThrow("Front image is not available");
    const ok = await makeRender(db, ids.myDesignId, ids.renderOfGood);
    await addToCart({ designId: ids.myDesignId, front: ok, ...OPTS });
    expect(await db.select().from(schema.cartItem)).toHaveLength(1);
  });
});

describe("a stranger's render of a seller's image follows the seller's image", () => {
  it("works as a back while the image is published, then is refused once it is hidden or unpublished", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    // A different user whose own design holds a render of the seller's image.
    await makeUser(db, "stranger");
    const theirs = await makeDesign(db, "stranger");
    const ownImage = await makeSourceImage(db, {
      designId: theirs.id,
      ownerId: "stranger",
      imageUrl: "https://img.example/stranger.png",
    });
    const r2 = await makeRender(db, theirs.id, ids.sellerPublishedId);
    h.session = { user: { id: "stranger", isAnonymous: false } };

    // The seller's image itself and its render agree while published.
    await addToCart({ frontImageId: ids.sellerPublishedId, back: r2, ...OPTS });
    await addToCart({ designId: theirs.id, front: ownImage, back: r2, ...OPTS });
    expect(await db.select().from(schema.cartItem)).toHaveLength(2);
    expect((await getCart()).items.every((i) => !i.unavailable)).toBe(true);

    // Hidden: back S is refused, and so is back R2 (it was not before).
    await setPublication(db, ids.sellerPublishedId, { isHidden: true });
    await expect(
      addToCart({ designId: theirs.id, front: ownImage, back: ids.sellerPublishedId, ...OPTS })
    ).rejects.toThrow("Back image is not available");
    await expect(
      addToCart({ designId: theirs.id, front: ownImage, back: r2, ...OPTS })
    ).rejects.toThrow("Back image is not available");
    // The carted line that pins R2 is flagged, and checkout is refused.
    expect((await getCart()).items.every((i) => i.unavailable)).toBe(true);
    const refused = await checkoutCart();
    expect(refused.error).toBeTruthy();
    expect(await db.select().from(schema.order)).toHaveLength(0);
    expect(h.stripeCalls).toBe(0);

    // Unpublished (listing gone) is refused the same way.
    await setPublication(db, ids.sellerPublishedId, { isHidden: false });
    await db.delete(schema.listing).where(eq(schema.listing.imageId, ids.sellerPublishedId));
    await expect(
      addToCart({ designId: theirs.id, front: ownImage, back: r2, ...OPTS })
    ).rejects.toThrow("Back image is not available");
  });
});

describe("renders that are fine still work", () => {
  it("a render of the user's own not-hidden image", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ designId: ids.myDesignId, front: ids.renderOfGood, ...OPTS });
    await buyPublishedDesign({ imageId: ids.goodId, backImageId: ids.renderOfGood, ...OPTS });
    await createCheckoutSession({
      designId: ids.myDesignId,
      front: ids.goodId,
      back: ids.renderOfGood,
      ...OPTS,
    });
    expect(await db.select().from(schema.orderItem)).toHaveLength(2);
  });

  it("a render of a stranger's still-published image, as a back", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await createCheckoutSession({
      designId: ids.myDesignId,
      front: ids.goodId,
      back: ids.renderOfSellers,
      ...OPTS,
    });
    const [line] = await db.select().from(schema.orderItem);
    expect(line.placements).toEqual({ front: ids.goodId, back: ids.renderOfSellers });
  });
});
