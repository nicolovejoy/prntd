/**
 * A line with no front pin is judged by the image it shows and prints (#310).
 * That is the design's display image: the primary when it resolves, otherwise
 * the design's latest output. A design with no primary whose latest output is
 * admin-hidden used to read as available. Real in-memory libSQL.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";

const h = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
  stripeCalls: 0,
  retrieve: vi.fn(),
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
          return { id: "cs_test_pl", url: "https://checkout.stripe.example/pl" };
        }),
        retrieve: (...a: unknown[]) => h.retrieve(...a),
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

import { addToCart, checkoutCart, getCart } from "@/app/cart/actions";
import { createCheckoutSession } from "@/app/order/actions";
import { cartLineStillValid } from "@/lib/cart-line-check";
import { lineHiddenArt } from "@/lib/line-hidden-art";
import { loadEmbeddedCheckout } from "@/lib/embedded-checkout-session";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };
const OWNER = { user: { id: "owner", email: "owner@example.com", isAnonymous: false } };

async function seed(db: Db, latest: "hidden" | "visible", withPrimary = false) {
  await makeUser(db, "owner");
  const design = await makeDesign(db, "owner");
  const id = await makeSourceImage(db, {
    designId: design.id,
    ownerId: "owner",
    imageUrl: "https://img.example/latest.png",
    publishedAt: latest === "hidden" ? new Date() : null,
    isHidden: latest === "hidden",
  });
  if (withPrimary) {
    await db
      .update(schema.design)
      .set({ primaryImageId: id })
      .where(eq(schema.design.id, design.id));
  }
  return { designId: design.id, imageId: id };
}

async function insertPinlessLine(db: Db, designId: string) {
  await db.insert(schema.cartItem).values({
    userId: "owner",
    designId,
    ...OPTS,
    placements: null,
  });
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = OWNER;
  h.stripeCalls = 0;
  h.retrieve.mockReset();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_abc123");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc123");
});
afterEach(() => vi.unstubAllEnvs());

describe("a design with no primary whose only output is hidden", () => {
  it("lineHiddenArt: front true", async () => {
    const { designId } = await seed(h.db as Db, "hidden");
    expect(await lineHiddenArt({ designId, placements: null })).toEqual({
      front: true,
      back: false,
    });
  });

  it("cartLineStillValid: false", async () => {
    const { designId } = await seed(h.db as Db, "hidden");
    expect(
      await cartLineStillValid({ designId, ...OPTS, placements: null }, "owner")
    ).toBe(false);
  });

  it("getCart: unavailable with no thumbnail; checkoutCart refuses and writes no order", async () => {
    const db = h.db as Db;
    const { designId } = await seed(db, "hidden");
    await insertPinlessLine(db, designId);

    const [line] = (await getCart()).items;
    expect(line.unavailable).toBe(true);
    expect(line.imageUrl).toBeNull();

    const result = await checkoutCart();
    expect(result.url).toBeNull();
    expect(result.error).toBeTruthy();
    expect(await db.select().from(schema.order)).toHaveLength(0);
    expect(h.stripeCalls).toBe(0);
  });

  it("addToCart through the designId entry rejects and writes no line", async () => {
    const db = h.db as Db;
    const { designId } = await seed(db, "hidden");
    await expect(addToCart({ designId, ...OPTS })).rejects.toThrow(
      "Front image is not available"
    );
    expect(await db.select().from(schema.cartItem)).toHaveLength(0);
  });

  it("createCheckoutSession rejects with no order row and no Stripe call", async () => {
    const db = h.db as Db;
    const { designId } = await seed(db, "hidden");
    await expect(createCheckoutSession({ designId, ...OPTS })).rejects.toThrow(
      "Front image is not available"
    );
    expect(await db.select().from(schema.order)).toHaveLength(0);
    expect(h.stripeCalls).toBe(0);
  });

  it("loadEmbeddedCheckout for a pending pinless order: expired", async () => {
    const db = h.db as Db;
    const { designId } = await seed(db, "hidden");
    const [order] = await db
      .insert(schema.order)
      .values({
        userId: "owner",
        designId,
        stripeSessionId: "cs_test_pinless",
        status: "pending",
        totalPrice: 24.12,
      })
      .returning();
    await db.insert(schema.orderItem).values({
      orderId: order.id,
      designId,
      productId: OPTS.productId,
      size: OPTS.size,
      color: OPTS.color,
      placements: null,
      quantity: 1,
      itemPrice: 19.43,
    });
    h.retrieve.mockResolvedValue({
      status: "open",
      ui_mode: "embedded",
      client_secret: "cs_secret",
      url: null,
    });
    expect(
      await loadEmbeddedCheckout({ sessionId: "cs_test_pinless", viewerId: "owner" })
    ).toEqual({ kind: "expired" });
  });
});

describe("unchanged cases", () => {
  it("no primary and a visible latest output: valid, keeps its thumbnail", async () => {
    const db = h.db as Db;
    const { designId } = await seed(db, "visible");
    expect(
      await cartLineStillValid({ designId, ...OPTS, placements: null }, "owner")
    ).toBe(true);
    await insertPinlessLine(db, designId);
    const [line] = (await getCart()).items;
    expect(line.unavailable).toBe(false);
    expect(line.imageUrl).toBe("https://img.example/latest.png");
  });

  it("a visible primary is valid", async () => {
    const { designId } = await seed(h.db as Db, "visible", true);
    expect(
      await cartLineStillValid({ designId, ...OPTS, placements: null }, "owner")
    ).toBe(true);
    expect((await lineHiddenArt({ designId, placements: null })).front).toBe(false);
  });
});

describe("a line whose hidden check throws (F3)", () => {
  it("getCart still renders; the unavailable line loses both thumbnails", async () => {
    const db = h.db as Db;
    const { designId, imageId } = await seed(db, "visible", true);
    // Unavailable for a reason other than a hide: the back pin names no image.
    await db.insert(schema.cartItem).values({
      userId: "owner",
      designId,
      ...OPTS,
      placements: { front: imageId, back: crypto.randomUUID() },
    });
    vi.mocked(lineHiddenArt).mockRejectedValueOnce(new Error("boom"));
    const view = await getCart();
    expect(view.items).toHaveLength(1);
    expect(view.items[0].unavailable).toBe(true);
    expect(view.items[0].imageUrl).toBeNull();
    expect(view.items[0].backImageUrl).toBeNull();
  });
});

describe("the entries judge the id they pin (G1)", () => {
  // Simpler invariant than a primary moving mid-call: with the pinless rule
  // stubbed to "not hidden", a hidden primary is still refused through the id
  // each entry goes on to pin.
  it("addToCart refuses a hidden primary even when lineHiddenArt says not hidden", async () => {
    const db = h.db as Db;
    const { designId } = await seed(db, "hidden", true);
    vi.mocked(lineHiddenArt).mockResolvedValueOnce({ front: false, back: false });
    await expect(addToCart({ designId, ...OPTS })).rejects.toThrow(
      "Front image is not available"
    );
    expect(await db.select().from(schema.cartItem)).toHaveLength(0);
  });

  it("createCheckoutSession refuses a hidden primary even when lineHiddenArt says not hidden", async () => {
    const db = h.db as Db;
    const { designId } = await seed(db, "hidden", true);
    vi.mocked(lineHiddenArt).mockResolvedValueOnce({ front: false, back: false });
    await expect(createCheckoutSession({ designId, ...OPTS })).rejects.toThrow(
      "Front image is not available"
    );
    expect(await db.select().from(schema.order)).toHaveLength(0);
    expect(h.stripeCalls).toBe(0);
  });
});

describe("a front pin that resolves to nothing uses the pinless rule (G2)", () => {
  async function seedDangling(db: Db) {
    const { designId, imageId } = await seed(db, "visible");
    const ghost = crypto.randomUUID();
    await db
      .update(schema.design)
      .set({ primaryImageId: ghost })
      .where(eq(schema.design.id, designId));
    return { designId, imageId, ghost };
  }
  async function hideImage(db: Db, imageId: string) {
    await db.insert(schema.imagePublication).values({
      imageId,
      publishedAt: new Date(),
      isHidden: true,
    });
  }

  it("latest output visible: not hidden; hidden: front true", async () => {
    const db = h.db as Db;
    const { designId, imageId, ghost } = await seedDangling(db);
    const line = { designId, placements: { front: ghost } };
    expect((await lineHiddenArt(line)).front).toBe(false);
    await hideImage(db, imageId);
    expect((await lineHiddenArt(line)).front).toBe(true);
  });

  it("the cart line shows no thumbnail", async () => {
    const db = h.db as Db;
    const { designId, imageId, ghost } = await seedDangling(db);
    await hideImage(db, imageId);
    await db.insert(schema.cartItem).values({
      userId: "owner",
      designId,
      ...OPTS,
      placements: { front: ghost },
    });
    const [line] = (await getCart()).items;
    expect(line.unavailable).toBe(true);
    expect(line.imageUrl).toBeNull();
  });

  it("loadEmbeddedCheckout for a pending order of that shape: expired", async () => {
    const db = h.db as Db;
    const { designId, imageId, ghost } = await seedDangling(db);
    await hideImage(db, imageId);
    const [order] = await db
      .insert(schema.order)
      .values({
        userId: "owner",
        designId,
        stripeSessionId: "cs_test_ghost",
        status: "pending",
        totalPrice: 24.12,
      })
      .returning();
    await db.insert(schema.orderItem).values({
      orderId: order.id,
      designId,
      productId: OPTS.productId,
      size: OPTS.size,
      color: OPTS.color,
      placements: { front: ghost },
      quantity: 1,
      itemPrice: 19.43,
    });
    h.retrieve.mockResolvedValue({
      status: "open",
      ui_mode: "embedded",
      client_secret: "cs_secret",
      url: null,
    });
    expect(
      await loadEmbeddedCheckout({ sessionId: "cs_test_ghost", viewerId: "owner" })
    ).toEqual({ kind: "expired" });
  });
});

describe("a failed hidden check refuses the line (G3)", () => {
  it("cartLineStillValid returns false when the check rejects", async () => {
    const { designId } = await seed(h.db as Db, "visible");
    vi.mocked(lineHiddenArt).mockRejectedValueOnce(new Error("boom"));
    expect(
      await cartLineStillValid({ designId, ...OPTS, placements: null }, "owner")
    ).toBe(false);
  });
});
