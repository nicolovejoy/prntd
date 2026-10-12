/**
 * A published image whose conversation was deleted (#321). It stays public,
 * but nothing can be ordered from it: `order.design_id` and
 * `cart_item.design_id` are NOT NULL foreign keys. The page offers no Order
 * and every buy action refuses before it writes anything. The state is built
 * with the real delete path (the image is a seed in a second conversation, so
 * the delete detaches it).
 *
 * The db singleton, auth session and Stripe are mocked; the database is real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import {
  makeUser,
  makeDesign,
  makeSourceImage,
} from "@/lib/__tests__/factories";
import { planDesignDeletion, executeDesignDeletion } from "@/lib/delete-design";

const h = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
  stripeCreate: vi.fn(),
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
  stripe: { checkout: { sessions: { create: h.stripeCreate } } },
}));

vi.mock("@/lib/printful", () => ({
  estimateOrderCosts: vi.fn(async () => null),
}));

import { buyPublishedDesign, getListingMockup } from "@/app/d/actions";
import { addToCart } from "@/app/cart/actions";
import { getImagePage } from "./normal-image-page";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };

async function seed(db: Db) {
  await makeUser(db, "seller");
  await makeUser(db, "buyer");

  const live = await makeDesign(db, "seller");
  const liveId = await makeSourceImage(db, {
    designId: live.id,
    ownerId: "seller",
    imageUrl: "https://img.example/live.png",
    publishedAt: new Date(),
  });

  const home = await makeDesign(db, "seller");
  const goneId = await makeSourceImage(db, {
    designId: home.id,
    ownerId: "seller",
    imageUrl: "https://img.example/gone.png",
    publishedAt: new Date(),
  });
  const other = await makeDesign(db, "seller");
  await db
    .insert(schema.conversationImage)
    .values({ designId: other.id, imageId: goneId, role: "seed" });

  const plan = await planDesignDeletion(db, home.id);
  expect(plan.images.map((i) => [i.imageId, i.outcome])).toEqual([
    [goneId, "detach-seed"],
  ]);
  await executeDesignDeletion(db, plan);
  expect(
    (await db.select().from(schema.design)).some((d) => d.id === home.id)
  ).toBe(false);
  expect(
    (await db.select().from(schema.imagePublication)).map((p) => p.imageId)
  ).toContain(goneId);

  return { liveId, goneId };
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = { user: { id: "buyer", isAnonymous: false } };
  h.stripeCreate.mockReset();
  h.stripeCreate.mockResolvedValue({
    id: "cs_test_gone",
    url: "https://checkout.stripe.example/cs_test_gone",
  });
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a published image whose conversation is gone", () => {
  it("its page is still public but offers no Order", async () => {
    const ids = await seed(h.db as Db);
    const page = await getImagePage(ids.goneId);
    expect(page).not.toBeNull();
    expect(page!.canOrder).toBe(false);
    expect(page!.hasSourceConversation).toBe(false);
    expect(page!.publishedAt).not.toBeNull();
  });

  it("an ordinary published image still offers Order", async () => {
    const ids = await seed(h.db as Db);
    const page = await getImagePage(ids.liveId);
    expect(page!.canOrder).toBe(true);
  });

  it("buyPublishedDesign rejects and writes no order and no Stripe session", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await expect(
      buyPublishedDesign({ imageId: ids.goneId, ...OPTS })
    ).rejects.toThrow();
    expect(await db.select().from(schema.order)).toHaveLength(0);
    expect(h.stripeCreate).not.toHaveBeenCalled();
  });

  it("addToCart rejects with Image is not available and writes no line", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await expect(
      addToCart({ frontImageId: ids.goneId, ...OPTS })
    ).rejects.toThrow("Image is not available");
    expect(await db.select().from(schema.cartItem)).toHaveLength(0);
  });

  it("the front mockup action rejects", async () => {
    const ids = await seed(h.db as Db);
    await expect(
      getListingMockup({
        imageId: ids.goneId,
        productId: OPTS.productId,
        colorName: OPTS.color,
      })
    ).rejects.toThrow("Unauthorized");
  });
});
