/**
 * The cart shows no thumbnail for admin-hidden artwork (#310 item 1). The
 * line stays, marked unavailable; only a hidden side loses its image, and only
 * a hide does: a line made unavailable some other way keeps its thumbnails.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";

const h = vi.hoisted(() => {
  process.env.ADMIN_EMAIL = "admin@example.com";
  return { db: null as unknown, session: null as unknown, stripeCalls: 0 as number };
});

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
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/ai", () => ({
  generatePublishedNaming: async () => ({ title: "Auto", description: "Auto" }),
}));
vi.mock("@/lib/email", () => ({
  sendOrderConfirmation: vi.fn(),
  sendOwnerOrderAlert: vi.fn(),
}));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(async () => {
          h.stripeCalls += 1;
          return { id: "cs_test_cl", url: "https://checkout.stripe.example/cl" };
        }),
      },
    },
  },
}));
vi.mock("@/lib/printful", () => ({
  estimateOrderCosts: vi.fn(async () => null),
  createOrder: vi.fn(),
  getOrderByExternalId: vi.fn(),
}));

vi.mock("@/lib/line-hidden-art", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/line-hidden-art")>();
  return { ...orig, lineHiddenArt: vi.fn(orig.lineHiddenArt) };
});

import { lineHiddenArt } from "@/lib/line-hidden-art";
import { addToCart, getCart } from "@/app/cart/actions";
import { unpublishImage } from "@/app/designs/actions";
import { setImageHidden } from "@/app/admin/actions";
type Db = Awaited<ReturnType<typeof createTestDb>>;

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };
const sess = (id: string, email = `${id}@example.com`) => ({
  user: { id, email, isAnonymous: false },
});
const SELLER = sess("seller");
const BUYER = sess("buyer");
const ADMIN = sess("admin", "admin@example.com");

async function seed(db: Db) {
  await makeUser(db, "seller");
  await makeUser(db, "buyer");
  await makeUser(db, "admin");
  const sold = await makeDesign(db, "seller");
  const publishedId = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: "https://img.example/published.png",
    publishedAt: new Date(),
  });
  const otherPublishedId = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: "https://img.example/published-2.png",
    publishedAt: new Date(),
  });
  const mine = await makeDesign(db, "buyer");
  const myId = await makeSourceImage(db, {
    designId: mine.id,
    ownerId: "buyer",
    imageUrl: "https://img.example/mine.png",
  });
  await db
    .update(schema.design)
    .set({ primaryImageId: myId })
    .where(eq(schema.design.id, mine.id));
  return { soldDesignId: sold.id, publishedId, otherPublishedId, myDesignId: mine.id, myId };
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = BUYER;
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
});
afterEach(() => vi.unstubAllEnvs());

async function hide(imageId: string, hidden: boolean) {
  const prev = h.session;
  h.session = ADMIN;
  await setImageHidden(imageId, hidden);
  h.session = prev;
}

describe("getCart and admin-hidden artwork", () => {
  it("a stranger's line stays, unavailable, with no thumbnail", async () => {
    const ids = await seed(h.db as Db);
    await addToCart({ frontImageId: ids.publishedId, ...OPTS });
    expect((await getCart()).items[0].imageUrl).toBe("https://img.example/published.png");

    await hide(ids.publishedId, true);
    const view = await getCart();
    expect(view.items).toHaveLength(1);
    expect(view.items[0].unavailable).toBe(true);
    expect(view.items[0].imageUrl).toBeNull();
  });

  it("a hidden back loses only the back thumbnail", async () => {
    const ids = await seed(h.db as Db);
    await addToCart({ frontImageId: ids.publishedId, back: ids.otherPublishedId, ...OPTS });
    await hide(ids.otherPublishedId, true);

    const [line] = (await getCart()).items;
    expect(line.unavailable).toBe(true);
    expect(line.imageUrl).toBe("https://img.example/published.png");
    expect(line.backImageUrl).toBeNull();
    expect(line.hasBack).toBe(true);
  });

  it("a line unpublished by the owner (not hidden) keeps its thumbnail", async () => {
    const ids = await seed(h.db as Db);
    await addToCart({ frontImageId: ids.publishedId, ...OPTS });
    h.session = SELLER;
    await unpublishImage(ids.publishedId);
    h.session = BUYER;

    const [line] = (await getCart()).items;
    expect(line.unavailable).toBe(true);
    expect(line.imageUrl).toBe("https://img.example/published.png");
  });

  it("an available line keeps both URLs", async () => {
    const ids = await seed(h.db as Db);
    await addToCart({ frontImageId: ids.publishedId, back: ids.otherPublishedId, ...OPTS });
    const [line] = (await getCart()).items;
    expect(line.unavailable).toBe(false);
    expect(line.imageUrl).toBe("https://img.example/published.png");
    expect(line.backImageUrl).toBe("https://img.example/published-2.png");
  });

  it("an available line with a front pin never calls lineHiddenArt", async () => {
    const ids = await seed(h.db as Db);
    await addToCart({ frontImageId: ids.publishedId, back: ids.otherPublishedId, ...OPTS });
    vi.mocked(lineHiddenArt).mockClear();
    expect((await getCart()).items[0].unavailable).toBe(false);
    expect(lineHiddenArt).not.toHaveBeenCalled();
  });

  it("hide, then unhide: the line and its thumbnail come back", async () => {
    const ids = await seed(h.db as Db);
    await addToCart({ frontImageId: ids.publishedId, ...OPTS });
    await hide(ids.publishedId, true);
    expect((await getCart()).items[0].imageUrl).toBeNull();

    await hide(ids.publishedId, false);
    const [line] = (await getCart()).items;
    expect(line.unavailable).toBe(false);
    expect(line.imageUrl).toBe("https://img.example/published.png");
  });

  it("the image's own owner sees no thumbnail of their hidden image either", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = SELLER;
    await addToCart({ frontImageId: ids.publishedId, ...OPTS });
    await hide(ids.publishedId, true);

    const [line] = (await getCart()).items;
    expect(line.unavailable).toBe(true);
    expect(line.imageUrl).toBeNull();
  });

  it("a pinless line on the user's own design whose primary is hidden", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await db.insert(schema.cartItem).values({
      userId: "buyer",
      designId: ids.myDesignId,
      productId: OPTS.productId,
      size: OPTS.size,
      color: OPTS.color,
      placements: null,
    });
    expect((await getCart()).items[0].imageUrl).toBe("https://img.example/mine.png");

    await db.insert(schema.imagePublication).values({
      imageId: ids.myId,
      publishedAt: new Date(),
      isHidden: true,
    });
    const [line] = (await getCart()).items;
    expect(line.unavailable).toBe(true);
    expect(line.imageUrl).toBeNull();
  });
});
