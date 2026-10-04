/**
 * buyPublishedDesign's return paths (#278) against a real in-memory libSQL.
 * Where Stripe's hosted cancel link and the embedded /checkout back link go
 * is built from the values the action validated, so a buyer who backs out
 * lands on the image detail page with the same product, size, colour and
 * back design open. Never from a path the client sent.
 *
 * The db singleton, auth session and Stripe are mocked; the database is real
 * (FKs enforced, schema-derived).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type Stripe from "stripe";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import { buyPageHref } from "@/lib/buy-page-picks";

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
            id: `cs_test_return_${h.sessionParams.length}`,
            url: "https://checkout.stripe.example/cs_test_return",
          };
        }),
      },
    },
  },
}));

import { buyPublishedDesign } from "@/app/d/actions";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };

async function seed(db: Db) {
  await makeUser(db, "seller");
  await makeUser(db, "buyer");
  await makeUser(db, "other");

  const sold = await makeDesign(db, "seller");
  const listingId = await makeSourceImage(db, {
    designId: sold.id,
    ownerId: "seller",
    imageUrl: "https://img.example/listing.png",
    publishedAt: new Date(),
  });
  const theirs = await makeDesign(db, "other");
  const otherShopId = await makeSourceImage(db, {
    designId: theirs.id,
    ownerId: "other",
    imageUrl: "https://img.example/other-shop.png",
    publishedAt: new Date(),
  });
  return { listingId, otherShopId };
}

function useEmbedded() {
  vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_abc123");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc123");
}

beforeEach(async () => {
  h.db = await createTestDb();
  h.session = { user: { id: "buyer", isAnonymous: false } };
  h.sessionParams = [];
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", undefined);
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", undefined);
  vi.stubEnv("STRIPE_SECRET_KEY", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buyPublishedDesign return paths (#278)", () => {
  it("hosted: the cancel URL reopens the panel with product, size, colour and back", async () => {
    const ids = await seed(h.db as Db);

    await buyPublishedDesign({
      imageId: ids.listingId,
      backImageId: ids.otherShopId,
      ...OPTS,
    });

    expect(h.sessionParams[0].cancel_url).toBe(
      `http://localhost:3000${buyPageHref(ids.listingId, {
        order: true,
        product: OPTS.productId,
        size: OPTS.size,
        color: OPTS.color,
        back: ids.otherShopId,
      })}`
    );
  });

  it("hosted: a swap carries swap=1", async () => {
    const ids = await seed(h.db as Db);

    await buyPublishedDesign({
      imageId: ids.listingId,
      frontImageId: ids.otherShopId,
      backImageId: ids.listingId,
      ...OPTS,
    });

    // The page image is the back after a swap, and the link names the pick
    // as its `back` with swap=1, the shape the panel parses.
    const cancel = new URL(h.sessionParams[0].cancel_url as string);
    expect(cancel.pathname).toBe(`/d/${ids.listingId}`);
    expect(cancel.searchParams.get("swap")).toBe("1");
    expect(cancel.searchParams.get("back")).toBe(ids.otherShopId);
  });

  it("embedded: /checkout's back link is the same path", async () => {
    useEmbedded();
    const ids = await seed(h.db as Db);

    const { url } = await buyPublishedDesign({
      imageId: ids.listingId,
      backImageId: ids.otherShopId,
      ...OPTS,
    });

    const path = buyPageHref(ids.listingId, {
      order: true,
      product: OPTS.productId,
      size: OPTS.size,
      color: OPTS.color,
      back: ids.otherShopId,
    });
    expect(url).toBe(
      `/checkout?session=cs_test_return_1&from=${encodeURIComponent(path)}`
    );
  });

  it("with MULTI_PLACEMENT_ENABLED off the path carries no back", async () => {
    vi.stubEnv("MULTI_PLACEMENT_ENABLED", "false");
    const ids = await seed(h.db as Db);

    await buyPublishedDesign({
      imageId: ids.listingId,
      backImageId: ids.otherShopId,
      ...OPTS,
    });

    const cancel = new URL(h.sessionParams[0].cancel_url as string);
    expect(cancel.searchParams.has("back")).toBe(false);
    expect(cancel.searchParams.has("swap")).toBe(false);
  });
});
