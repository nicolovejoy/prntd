/**
 * Attribution from placement-image owners, against a real (in-memory) libSQL
 * DB — composition plan §3, slice 3.
 *
 * The cases that matter are the ones the old `order_item.designId → design
 * .userId` derivation got wrong: a shirt whose front and back come from two
 * different people, and the same shirt read by one of those two people.
 * Legacy lines (no placements JSON) must keep the attribution they have
 * always shown, which is why the conversation owner survives as a fallback.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import {
  contributorAttribution,
  type Contributor,
} from "@/lib/order-attribution";
import {
  loadImageOwners,
  resolveOrderLineIdentities,
} from "@/lib/order-line-identity";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));

import { getUserOrdersData } from "@/lib/user-orders";

type Db = Awaited<ReturnType<typeof createTestDb>>;

/** A user with one conversation and one image in it. */
async function seedArtist(db: Db, userId: string) {
  await makeUser(db, userId);
  const design = await makeDesign(db, userId);
  const imageId = await makeSourceImage(db, {
    designId: design.id,
    ownerId: userId,
    imageUrl: `https://r2/${userId}.png`,
  });
  await db
    .update(schema.design)
    .set({ primaryImageId: imageId })
    .where(eq(schema.design.id, design.id));
  return { designId: design.id, imageId };
}

async function seedOrder(
  db: Db,
  params: {
    buyerId: string;
    designId: string;
    placements: Record<string, string> | null;
  }
) {
  const [order] = await db
    .insert(schema.order)
    .values({
      userId: params.buyerId,
      designId: params.designId,
      totalPrice: 27.43,
      status: "paid",
    })
    .returning();
  await db.insert(schema.orderItem).values({
    orderId: order.id,
    designId: params.designId,
    productId: "bella-canvas-3001",
    size: "L",
    color: "Black",
    quantity: 1,
    itemPrice: 27.43,
    placements: params.placements,
  });
  return order;
}

/** The rendered "Designed by …" text of the order's single line, or null. */
async function attributionFor(buyerId: string): Promise<string | null> {
  const orders = await getUserOrdersData(buyerId);
  return orders[0].lines[0].designedByName;
}

describe("order attribution from placement-image owners", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
    h.db = db;
  });

  it("names the single contributor of a one-sided shirt", async () => {
    await makeUser(db, "buyer");
    const ada = await seedArtist(db, "ada");
    await seedOrder(db, {
      buyerId: "buyer",
      designId: ada.designId,
      placements: { front: ada.imageId },
    });

    expect(await attributionFor("buyer")).toBe("ada");
  });

  it("names both contributors of a two-sided shirt, front first", async () => {
    await makeUser(db, "buyer");
    const ada = await seedArtist(db, "ada");
    const bo = await seedArtist(db, "bo");
    // The order's designId is Ada's conversation — the old derivation would
    // have named only her.
    await seedOrder(db, {
      buyerId: "buyer",
      designId: ada.designId,
      placements: { front: ada.imageId, back: bo.imageId },
    });

    expect(await attributionFor("buyer")).toBe("ada & bo");
  });

  it("orders the names front-first regardless of the JSON key order", async () => {
    await makeUser(db, "buyer");
    const ada = await seedArtist(db, "ada");
    const bo = await seedArtist(db, "bo");
    await seedOrder(db, {
      buyerId: "buyer",
      designId: ada.designId,
      placements: { back: bo.imageId, front: ada.imageId },
    });

    expect(await attributionFor("buyer")).toBe("ada & bo");
  });

  it("drops the viewer's own name when they are one of two contributors", async () => {
    const ada = await seedArtist(db, "ada");
    const bo = await seedArtist(db, "bo");
    // Ada bought the shirt carrying her front and Bo's back.
    await seedOrder(db, {
      buyerId: "ada",
      designId: ada.designId,
      placements: { front: ada.imageId, back: bo.imageId },
    });

    expect(await attributionFor("ada")).toBe("bo");
  });

  it("shows nothing when the viewer contributed both placements", async () => {
    const ada = await seedArtist(db, "ada");
    const second = await makeSourceImage(db, {
      designId: ada.designId,
      ownerId: "ada",
      imageUrl: "https://r2/ada-2.png",
    });
    await seedOrder(db, {
      buyerId: "ada",
      designId: ada.designId,
      placements: { front: ada.imageId, back: second },
    });

    expect(await attributionFor("ada")).toBeNull();
  });

  it("collapses one owner who supplied both sides to a single name", async () => {
    await makeUser(db, "buyer");
    const ada = await seedArtist(db, "ada");
    const second = await makeSourceImage(db, {
      designId: ada.designId,
      ownerId: "ada",
      imageUrl: "https://r2/ada-2.png",
    });
    await seedOrder(db, {
      buyerId: "buyer",
      designId: ada.designId,
      placements: { front: ada.imageId, back: second },
    });

    expect(await attributionFor("buyer")).toBe("ada");
  });

  it("falls back to the conversation owner for a legacy line with no placements", async () => {
    await makeUser(db, "buyer");
    const ada = await seedArtist(db, "ada");
    await seedOrder(db, {
      buyerId: "buyer",
      designId: ada.designId,
      placements: null,
    });

    expect(await attributionFor("buyer")).toBe("ada");
  });

  it("falls back to the conversation owner when the pin is a placement render", async () => {
    await makeUser(db, "buyer");
    const ada = await seedArtist(db, "ada");
    const renderId = crypto.randomUUID();
    await db.insert(schema.placementRender).values({
      id: renderId,
      designId: ada.designId,
      blankId: "bella-canvas-3001",
      placementId: "front",
      imageUrl: "https://r2/render.png",
      aspectRatio: "1:1",
    });
    await seedOrder(db, {
      buyerId: "buyer",
      designId: ada.designId,
      placements: { front: renderId },
    });

    expect(await attributionFor("buyer")).toBe("ada");
  });
});

describe("resolveOrderLineIdentities contributors (the admin order detail path)", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
    h.db = db;
  });

  it("carries both owners of a two-sided line, front first", async () => {
    const ada = await seedArtist(db, "ada");
    const bo = await seedArtist(db, "bo");

    const [identity] = await resolveOrderLineIdentities(db, [
      {
        designId: ada.designId,
        placements: { back: bo.imageId, front: ada.imageId },
      },
    ]);

    expect(identity.contributors).toEqual<Contributor[]>([
      { userId: "ada", name: "ada" },
      { userId: "bo", name: "bo" },
    ]);
    // What the admin page renders for the buyer of that shirt.
    expect(
      contributorAttribution({
        contributors: identity.contributors,
        viewerId: "buyer",
      })
    ).toBe("ada & bo");
  });

  it("resolves owners in one query and does not grow with line count", async () => {
    const ada = await seedArtist(db, "ada");
    const bo = await seedArtist(db, "bo");
    const cy = await seedArtist(db, "cy");

    const select = vi.spyOn(db, "select");

    // Two lines, three distinct placement images.
    await resolveOrderLineIdentities(db, [
      {
        designId: ada.designId,
        placements: { front: ada.imageId, back: bo.imageId },
      },
      { designId: cy.designId, placements: { front: cy.imageId } },
    ]);
    const twoLines = select.mock.calls.length;

    select.mockClear();
    await resolveOrderLineIdentities(db, [
      { designId: ada.designId, placements: { front: ada.imageId } },
    ]);
    expect(select.mock.calls.length).toBe(twoLines);

    // The shared owner loader itself is a single query for any id count.
    select.mockClear();
    const owners = await loadImageOwners(db, [ada.imageId, bo.imageId, cy.imageId]);
    expect(select.mock.calls.length).toBe(1);
    expect([...owners.keys()].sort()).toEqual(
      [ada.imageId, bo.imageId, cy.imageId].sort()
    );

    select.mockRestore();
  });
});
