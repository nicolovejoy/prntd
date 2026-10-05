/**
 * Owner ruling (Nico, 2026-10-05): once an admin hides an image, nobody can
 * buy or print it, its owner included, and the owner must not be able to undo
 * the hide. Hidden is recorded in two places (the `listing` row's is_hidden
 * and the mirror product's status), and `unpublishImage` deletes the first and
 * drafts the second, so without a refusal an owner could erase a hide by
 * unpublishing and then publish again.
 *
 * Real in-memory libSQL; db, session and Stripe mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import type Stripe from "stripe";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";

const h = vi.hoisted(() => {
  process.env.ADMIN_EMAIL = "admin@example.com";
  return {
    db: null as unknown,
    session: null as unknown,
    stripeCalls: 0 as number,
  };
});

vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => h.session } },
  isAnonymousUser: (u: { isAnonymous?: boolean } | undefined) =>
    Boolean(u?.isAnonymous),
}));
vi.mock("@/lib/ai", () => ({
  generatePublishedNaming: async () => ({ title: "Auto", description: "Auto" }),
}));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(async (_p: Stripe.Checkout.SessionCreateParams) => {
          h.stripeCalls += 1;
          return { id: "cs_test_hide", url: "https://checkout.stripe.example/x" };
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
vi.mock("@/lib/email", () => ({
  sendOrderConfirmation: vi.fn(),
  sendOwnerOrderAlert: vi.fn(),
}));

import { publishImage, unpublishImage } from "@/app/designs/actions";
import { setImageHidden } from "@/app/admin/actions";
import { buyPublishedDesign } from "@/app/d/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };
const OWNER = { user: { id: "owner", email: "owner@example.com", isAnonymous: false } };
const ADMIN = { user: { id: "admin", email: "admin@example.com", isAnonymous: false } };
const STRANGER = { user: { id: "stranger", email: "s@example.com", isAnonymous: false } };

async function seed(db: Db) {
  await makeUser(db, "owner");
  await makeUser(db, "admin");
  await makeUser(db, "stranger");
  const design = await makeDesign(db, "owner");
  const imageId = await makeSourceImage(db, {
    designId: design.id,
    ownerId: "owner",
    imageUrl: "https://img.example/a.png",
  });
  return { imageId, designId: design.id };
}

async function state(db: Db, imageId: string) {
  const listings = await db
    .select()
    .from(schema.listing)
    .where(eq(schema.listing.imageId, imageId));
  const mirrors = (
    await db
      .select()
      .from(schema.product)
      .where(and(isNull(schema.product.storeId), isNull(schema.product.designId)))
  ).filter((p) => (p.placements ?? {}).front === imageId);
  return {
    listing: listings[0] ? { hidden: listings[0].isHidden } : null,
    mirror: mirrors[0] ? { status: mirrors[0].status, title: mirrors[0].title } : null,
  };
}

async function publishHidden(db: Db) {
  const ids = await seed(db);
  h.session = OWNER;
  await publishImage(ids.imageId, { title: "Original", backgroundColor: "Black" });
  h.session = ADMIN;
  await setImageHidden(ids.imageId, true);
  return ids;
}

async function expectNoOrders(db: Db) {
  expect(await db.select().from(schema.order)).toHaveLength(0);
  expect(await db.select().from(schema.orderItem)).toHaveLength(0);
  expect(h.stripeCalls).toBe(0);
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.stripeCalls = 0;
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
});

describe("an admin hide cannot be undone by the owner", () => {
  it("unpublishImage on a hidden image throws and changes neither row", async () => {
    const db = h.db as Db;
    const { imageId } = await publishHidden(db);
    const before = await state(db, imageId);
    expect(before).toEqual({
      listing: { hidden: true },
      mirror: { status: "hidden", title: "Original" },
    });

    h.session = OWNER;
    await expect(unpublishImage(imageId)).rejects.toThrow();
    expect(await state(db, imageId)).toEqual(before);
  });

  it("publishImage on a hidden image throws and changes neither row", async () => {
    const db = h.db as Db;
    const { imageId } = await publishHidden(db);
    const before = await state(db, imageId);

    h.session = OWNER;
    await expect(
      publishImage(imageId, { title: "Again", backgroundColor: "White" })
    ).rejects.toThrow();
    expect(await state(db, imageId)).toEqual(before);
  });

  it("refuses when only the mirror records the hide", async () => {
    const db = h.db as Db;
    const { imageId } = await publishHidden(db);
    await db.update(schema.listing).set({ isHidden: false });
    const before = await state(db, imageId);

    h.session = OWNER;
    await expect(unpublishImage(imageId)).rejects.toThrow();
    expect(await state(db, imageId)).toEqual(before);
  });

  it("the whole proved sequence ends with the owner's and a stranger's buy refused", async () => {
    const db = h.db as Db;
    const { imageId } = await publishHidden(db);

    h.session = OWNER;
    await expect(unpublishImage(imageId)).rejects.toThrow();
    await expect(publishImage(imageId, { title: "Back" })).rejects.toThrow();
    await expect(buyPublishedDesign({ imageId, ...OPTS })).rejects.toThrow();
    h.session = STRANGER;
    await expect(buyPublishedDesign({ imageId, ...OPTS })).rejects.toThrow();
    await expectNoOrders(db);
  });

  it("after an admin unhide the owner can unpublish and publish again", async () => {
    const db = h.db as Db;
    const { imageId } = await publishHidden(db);
    h.session = ADMIN;
    await setImageHidden(imageId, false);

    h.session = OWNER;
    await unpublishImage(imageId);
    expect((await state(db, imageId)).listing).toBeNull();
    await publishImage(imageId, { title: "Second" });
    expect(await state(db, imageId)).toEqual({
      listing: { hidden: false },
      mirror: { status: "listed", title: "Second" },
    });
  });

  it("an admin can hide and unhide repeatedly", async () => {
    const db = h.db as Db;
    const { imageId } = await publishHidden(db);
    h.session = ADMIN;
    await setImageHidden(imageId, false);
    await setImageHidden(imageId, true);
    expect((await state(db, imageId)).listing).toEqual({ hidden: true });
  });
});
