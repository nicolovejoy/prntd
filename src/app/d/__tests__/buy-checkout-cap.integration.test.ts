/**
 * buyPublishedDesign's daily checkout cap (#316) against a real in-memory
 * libSQL. The cap is counted right after the sign-in check and before the
 * image is read, and a refusal comes back as data.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage, setPublication } from "@/lib/__tests__/factories";
import { CHECKOUT_LIMIT_REACHED, CHECKOUT_LIMIT_REACHED_IP } from "@/lib/action-copy";
import { dayKeyUTC } from "@/lib/generation-quota";

const h = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
  forwardedFor: null as string | null,
  create: vi.fn(),
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
    new Headers(h.forwardedFor ? { "x-forwarded-for": h.forwardedFor } : {}),
}));

vi.mock("@/lib/printful", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/printful")>()),
  estimateOrderCosts: vi.fn(async () => null),
}));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        expire: vi.fn(async (id: string) => ({ id, status: "expired" })),
        create: (...args: unknown[]) => h.create(...args),
      },
    },
  },
}));

import { buyPublishedDesign } from "@/app/d/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const BUYER = { user: { id: "buyer", isAnonymous: false } };
const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };
const TODAY = () => dayKeyUTC(new Date());

async function setBucket(db: Db, bucket: string, count: number) {
  await db
    .insert(schema.generationUsage)
    .values({ bucket, day: TODAY(), count })
    .onConflictDoUpdate({
      target: [schema.generationUsage.bucket, schema.generationUsage.day],
      set: { count },
    });
}

async function bucketCount(db: Db, bucket: string): Promise<number | null> {
  const [row] = await db
    .select({ c: schema.generationUsage.count })
    .from(schema.generationUsage)
    .where(
      and(
        eq(schema.generationUsage.bucket, bucket),
        eq(schema.generationUsage.day, TODAY())
      )
    );
  return row?.c ?? null;
}

async function seed(db: Db) {
  await makeUser(db, "seller");
  await makeUser(db, "buyer");
  const sold = await makeDesign(db, "seller");
  const imageId = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: "https://img.example/listing.png",
    publishedAt: new Date(),
  });
  return { imageId };
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = BUYER;
  h.forwardedFor = null;
  h.create.mockReset();
  h.create.mockResolvedValue({
    id: "cs_test_1",
    url: "https://checkout.stripe.example/cs_test_hosted",
  });
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buyPublishedDesign daily checkout cap (#316)", () => {
  it("at the cap: refused as data, no order, Stripe not called", async () => {
    const db = h.db as Db;
    const { imageId } = await seed(db);
    await setBucket(db, "checkout:user:buyer", 30);

    const result = await buyPublishedDesign({ imageId, ...OPTS });

    expect(result).toEqual({ url: null, error: CHECKOUT_LIMIT_REACHED });
    expect((await db.select().from(schema.order)).length).toBe(0);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("the cap is checked before the image: a hidden image at the cap returns the cap error, not a throw", async () => {
    const db = h.db as Db;
    const { imageId } = await seed(db);
    await setPublication(db, imageId, { isHidden: true });
    await setBucket(db, "checkout:user:buyer", 30);

    await expect(buyPublishedDesign({ imageId, ...OPTS })).resolves.toEqual({
      url: null,
      error: CHECKOUT_LIMIT_REACHED,
    });
  });

  it("one under the cap: proceeds, and the bucket is at 30 afterwards", async () => {
    const db = h.db as Db;
    const { imageId } = await seed(db);
    await setBucket(db, "checkout:user:buyer", 29);

    const result = await buyPublishedDesign({ imageId, ...OPTS });

    expect(result.error).toBeUndefined();
    expect(result.url).toBeTruthy();
    expect(h.create).toHaveBeenCalledTimes(1);
    expect((await db.select().from(schema.order)).length).toBe(1);
    expect(await bucketCount(db, "checkout:user:buyer")).toBe(30);
  });

  it("IP bucket at 100 with the identity under cap: the network line", async () => {
    h.forwardedFor = "198.51.100.7, 10.0.0.1";
    const db = h.db as Db;
    const { imageId } = await seed(db);
    await setBucket(db, "checkout:ip:198.51.100.7", 100);

    expect(await buyPublishedDesign({ imageId, ...OPTS })).toEqual({
      url: null,
      error: CHECKOUT_LIMIT_REACHED_IP,
    });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("a guest gets needsAuth and no bucket is bumped", async () => {
    h.session = { user: { id: "buyer", isAnonymous: true } };
    const db = h.db as Db;
    const { imageId } = await seed(db);

    expect(await buyPublishedDesign({ imageId, ...OPTS })).toEqual({
      url: null,
      needsAuth: true,
    });
    expect(await bucketCount(db, "checkout:user:buyer")).toBeNull();
  });
});
