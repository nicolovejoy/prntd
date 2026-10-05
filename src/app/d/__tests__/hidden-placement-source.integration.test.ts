/**
 * Owner ruling (Nico, 2026-10-05): an admin-hidden image can be neither bought
 * nor printed by anyone, its owner included. `canUseAsPlacementSource` used to
 * grant on ownership before it looked at is_hidden, so an owner could still
 * print their hidden image as a back or a swapped front. Every consumer of that
 * guard is exercised here with the owner's HIDDEN image and with the same
 * owner's not-hidden image (which must still work). A refusal writes no order,
 * no cart row and makes no Stripe call.
 *
 * Real in-memory libSQL; db, session and Stripe mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";

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
          return { id: "cs_test_hp", url: "https://checkout.stripe.example/hp" };
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

import {
  buyPublishedDesign,
  getListingMockup,
  getListingBackMockup,
  resolveInitialBack,
  getBuyPageBackSources,
} from "@/app/d/actions";
import { addToCart } from "@/app/cart/actions";
import { createCheckoutSession } from "@/app/order/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };

async function seed(db: Db) {
  await makeUser(db, "owner");
  const conversation = await makeDesign(db, "owner");
  const pageId = await makeSourceImage(db, {
    designId: conversation.id,
    ownerId: "owner",
    imageUrl: "https://img.example/page.png",
  });
  const goodId = await makeSourceImage(db, {
    designId: conversation.id,
    ownerId: "owner",
    imageUrl: "https://img.example/good.png",
  });
  const hiddenId = await makeSourceImage(db, {
    designId: conversation.id,
    ownerId: "owner",
    imageUrl: "https://img.example/hidden.png",
    publishedAt: new Date(),
    isHidden: true,
  });
  await db
    .update(schema.design)
    .set({ primaryImageId: pageId })
    .where(eq(schema.design.id, conversation.id));
  return { conversationId: conversation.id, pageId, goodId, hiddenId };
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

describe("buyPublishedDesign refuses the owner's hidden image as a placement", () => {
  it("as the back", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await expect(
      buyPublishedDesign({ imageId: ids.pageId, backImageId: ids.hiddenId, ...OPTS })
    ).rejects.toThrow("Back image is not available");
    await expectNothingWritten(db);
  });

  it("as a swapped front", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await expect(
      buyPublishedDesign({
        imageId: ids.pageId,
        frontImageId: ids.hiddenId,
        backImageId: ids.pageId,
        ...OPTS,
      })
    ).rejects.toThrow("Front image is not available");
    await expectNothingWritten(db);
  });

  it("while a not-hidden own image still works as the back", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await buyPublishedDesign({ imageId: ids.pageId, backImageId: ids.goodId, ...OPTS });
    const [line] = await db.select().from(schema.orderItem);
    expect(line.placements).toEqual({ front: ids.pageId, back: ids.goodId });
  });
});

describe("addToCart refuses the owner's hidden image as a placement", () => {
  it("as the back and as a swapped front on the page path", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await expect(
      addToCart({ frontImageId: ids.pageId, back: ids.hiddenId, ...OPTS })
    ).rejects.toThrow("Back image is not available");
    await expect(
      addToCart({
        frontImageId: ids.pageId,
        front: ids.hiddenId,
        back: ids.pageId,
        ...OPTS,
      })
    ).rejects.toThrow("Front image is not available");
    await expectNothingWritten(db);
  });

  it("as the front and the back on the design path", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await expect(
      addToCart({ designId: ids.conversationId, front: ids.hiddenId, ...OPTS })
    ).rejects.toThrow("Front image is not available");
    await expect(
      addToCart({ designId: ids.conversationId, back: ids.hiddenId, ...OPTS })
    ).rejects.toThrow("Back image is not available");
    await expectNothingWritten(db);
  });

  it("while a not-hidden own image still works", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.pageId, back: ids.goodId, ...OPTS });
    expect(await db.select().from(schema.cartItem)).toHaveLength(1);
  });
});

describe("createCheckoutSession refuses the owner's hidden image", () => {
  it("as the front", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await expect(
      createCheckoutSession({ designId: ids.conversationId, front: ids.hiddenId, ...OPTS })
    ).rejects.toThrow("Front image is not available");
    await expectNothingWritten(db);
  });

  it("as the back", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await expect(
      createCheckoutSession({
        designId: ids.conversationId,
        front: ids.pageId,
        back: ids.hiddenId,
        ...OPTS,
      })
    ).rejects.toThrow("Back image is not available");
    await expectNothingWritten(db);
  });

  it("as the design's implicit primary (no front sent)", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await db
      .update(schema.design)
      .set({ primaryImageId: ids.hiddenId })
      .where(eq(schema.design.id, ids.conversationId));
    await expect(
      createCheckoutSession({ designId: ids.conversationId, ...OPTS })
    ).rejects.toThrow("Front image is not available");
    await expectNothingWritten(db);
  });

  it("while a not-hidden own image still works", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await createCheckoutSession({
      designId: ids.conversationId,
      front: ids.pageId,
      back: ids.goodId,
      ...OPTS,
    });
    const [line] = await db.select().from(schema.orderItem);
    expect(line.placements).toEqual({ front: ids.pageId, back: ids.goodId });
  });
});

describe("the mockup actions and the link resolver refuse it too", () => {
  it("getListingMockup with the hidden image as a swapped front", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await expect(
      getListingMockup({
        imageId: ids.pageId,
        productId: OPTS.productId,
        colorName: "Black",
        frontImageId: ids.hiddenId,
      })
    ).rejects.toThrow("Front image is not available");
    expect(mockupRender.renderAndCacheMockup).not.toHaveBeenCalled();
    await getListingMockup({
      imageId: ids.pageId,
      productId: OPTS.productId,
      colorName: "Black",
      frontImageId: ids.goodId,
    });
    expect(mockupRender.renderAndCacheMockup).toHaveBeenCalledTimes(1);
  });

  it("getListingBackMockup with the hidden image as the back", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await expect(
      getListingBackMockup({
        imageId: ids.pageId,
        backImageId: ids.hiddenId,
        productId: OPTS.productId,
        colorName: "Black",
      })
    ).rejects.toThrow("Back image is not available");
    expect(mockupRender.renderAndCacheMockup).not.toHaveBeenCalled();
    await getListingBackMockup({
      imageId: ids.pageId,
      backImageId: ids.goodId,
      productId: OPTS.productId,
      colorName: "Black",
    });
    expect(mockupRender.renderAndCacheMockup).toHaveBeenCalledTimes(1);
  });

  it("resolveInitialBack returns null for it and the pick for a not-hidden own image", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    expect(await resolveInitialBack(ids.pageId, ids.hiddenId)).toBeNull();
    expect(await resolveInitialBack(ids.pageId, ids.goodId)).toEqual({
      id: ids.goodId,
      imageUrl: "https://img.example/good.png",
    });
  });
});

describe("the back-source lists do not offer a hidden image", () => {
  it("This design omits it; My Designs omits a hidden primary", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    // A second conversation whose primary is hidden, for My Designs.
    const other = await makeDesign(db, "owner");
    const otherHidden = await makeSourceImage(db, {
      designId: other.id,
      ownerId: "owner",
      imageUrl: "https://img.example/other-hidden.png",
      publishedAt: new Date(),
      isHidden: true,
    });
    await db
      .update(schema.design)
      .set({ primaryImageId: otherHidden })
      .where(eq(schema.design.id, other.id));

    const { groups } = await getBuyPageBackSources(ids.pageId);
    const thisDesign = groups.find((g) => g.id === "this-design")!;
    const ids1 = thisDesign.images.map((i) => i.id);
    expect(ids1).toContain(ids.goodId);
    expect(ids1).not.toContain(ids.hiddenId);
    const mine = groups.find((g) => g.id === "my-designs");
    expect(mine?.images.map((i) => i.id) ?? []).not.toContain(otherHidden);
    const shown = groups.flatMap((g) => g.images.map((i) => i.id));
    expect(shown).not.toContain(otherHidden);
    expect(shown).not.toContain(ids.hiddenId);
  });
});
