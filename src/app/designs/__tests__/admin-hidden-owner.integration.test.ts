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
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";

const h = vi.hoisted(() => {
  process.env.ADMIN_EMAIL = "admin@example.com";
  return {
    db: null as unknown,
    session: null as unknown,
    stripeCalls: 0 as number,
    afterHiddenCheck: null as null | (() => Promise<void>),
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
// Lets a test run code between unpublishImage's hidden check and its write.
vi.mock("@/lib/model-b-writes", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/model-b-writes")>();
  return {
    ...actual,
    isImageAdminHidden: async (db: Parameters<typeof actual.isImageAdminHidden>[0], id: string) => {
      const result = await actual.isImageAdminHidden(db, id);
      if (h.afterHiddenCheck) await h.afterHiddenCheck();
      return result;
    },
  };
});
vi.mock("@/lib/ai", () => ({
  generatePublishedNaming: async () => ({ title: "Auto", description: "Auto" }),
}));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(async () => {
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
  h.afterHiddenCheck = null;
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

describe("an admin hide that lands between the check and the write survives (second round, fix 3)", () => {
  it("unpublishImage's write is conditional: both rows stay hidden, the owner's and a stranger's buy are refused", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = OWNER;
    await publishImage(ids.imageId, { title: "Original", backgroundColor: "Black" });

    // The admin's hide commits after unpublishImage has read "not hidden".
    h.afterHiddenCheck = async () => {
      h.afterHiddenCheck = null;
      const owner = h.session;
      h.session = ADMIN;
      await setImageHidden(ids.imageId, true);
      h.session = owner;
    };
    await expect(unpublishImage(ids.imageId)).rejects.toThrow("This image is not available");

    expect(await state(db, ids.imageId)).toEqual({
      listing: { hidden: true },
      mirror: { status: "hidden", title: "Original" },
    });
    h.session = OWNER;
    await expect(buyPublishedDesign({ imageId: ids.imageId, ...OPTS })).rejects.toThrow();
    h.session = STRANGER;
    await expect(buyPublishedDesign({ imageId: ids.imageId, ...OPTS })).rejects.toThrow();
    await expectNoOrders(db);
  });

  it("an ordinary unpublish still deletes the listing and drafts the mirror", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = OWNER;
    await publishImage(ids.imageId, { title: "T", backgroundColor: "Black" });
    await unpublishImage(ids.imageId);
    expect(await state(db, ids.imageId)).toEqual({
      listing: null,
      mirror: { status: "draft", title: "T" },
    });
  });

  it("a second unpublish of an already-unpublished image is still a quiet no-op", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    h.session = OWNER;
    await publishImage(ids.imageId, { title: "T", backgroundColor: "Black" });
    await unpublishImage(ids.imageId);
    await expect(unpublishImage(ids.imageId)).resolves.toBeUndefined();
  });
});
