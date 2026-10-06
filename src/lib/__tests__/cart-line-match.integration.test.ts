/**
 * #289 item 3: the condition the webhook deletes cart lines with. Real
 * libSQL; the JSON is compared by value, not by text.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign } from "./factories";
import { cartLineMatch } from "@/lib/cart-line-match";

type Db = Awaited<ReturnType<typeof createTestDb>>;
type Placements = Record<string, string> | null;

let db: Db;
let designId: string;

const BASE = { productId: "bella-canvas-3001", size: "M", color: "Black" };

async function addLine(
  placements: Placements,
  overrides: Partial<typeof schema.cartItem.$inferInsert> = {}
) {
  const [row] = await db
    .insert(schema.cartItem)
    .values({ userId: "buyer", designId, ...BASE, placements, ...overrides })
    .returning();
  return row.id;
}

async function deleteMatching(placements: Placements) {
  await db
    .delete(schema.cartItem)
    .where(cartLineMatch("buyer", { designId, ...BASE, placements }));
}

async function remainingIds() {
  return (await db.select().from(schema.cartItem)).map((r) => r.id);
}

beforeEach(async () => {
  db = await createTestDb();
  await makeUser(db, "buyer");
  await makeUser(db, "other");
  designId = (await makeDesign(db, "buyer")).id;
});

describe("cartLineMatch", () => {
  it("removes the line with the same front", async () => {
    const mine = await addLine({ front: "A" });
    await deleteMatching({ front: "A" });
    expect(await remainingIds()).not.toContain(mine);
  });

  it("keeps a line for a different front image of the same design", async () => {
    const sibling = await addLine({ front: "B" });
    await deleteMatching({ front: "A" });
    expect(await remainingIds()).toEqual([sibling]);
  });

  it("keeps a line with a back when the purchase has none, and the reverse", async () => {
    const withBack = await addLine({ front: "A", back: "C" });
    const noBack = await addLine({ front: "A" });
    await deleteMatching({ front: "A" });
    expect(await remainingIds()).toEqual([withBack]);
    await deleteMatching({ front: "A", back: "C" });
    expect(await remainingIds()).toEqual([]);
    expect(noBack).toBeTruthy();
  });

  it("keeps a line with a different back", async () => {
    const otherBack = await addLine({ front: "A", back: "D" });
    await deleteMatching({ front: "A", back: "C" });
    expect(await remainingIds()).toEqual([otherBack]);
  });

  it("matches when the stored JSON has its keys in the other order", async () => {
    await db.run(
      sql`insert into cart_item (id, user_id, design_id, product_id, size, color, placements, quantity, created_at)
          values ('reordered', 'buyer', ${designId}, ${BASE.productId}, ${BASE.size}, ${BASE.color}, '{"back":"C","front":"A"}', 1, 0)`
    );
    await deleteMatching({ front: "A", back: "C" });
    expect(await remainingIds()).toEqual([]);
  });

  it("matches null placements to null placements only", async () => {
    const legacy = await addLine(null);
    const pinned = await addLine({ front: "A" });
    await deleteMatching(null);
    expect(await remainingIds()).toEqual([pinned]);
    await deleteMatching({ front: "A" });
    expect(await remainingIds()).toEqual([]);
    expect(legacy).toBeTruthy();
  });

  it("a pinned purchase does not clear a line with null placements", async () => {
    const legacy = await addLine(null);
    await deleteMatching({ front: "A" });
    expect(await remainingIds()).toEqual([legacy]);
  });

  it("still scopes by user, design, product, size and colour", async () => {
    const otherUser = await addLine({ front: "A" }, { userId: "other" });
    const otherSize = await addLine({ front: "A" }, { size: "L" });
    const otherColor = await addLine({ front: "A" }, { color: "White" });
    const otherProduct = await addLine({ front: "A" }, { productId: "other-blank" });
    const otherDesign = await addLine(
      { front: "A" },
      { designId: (await makeDesign(db, "buyer")).id }
    );
    await deleteMatching({ front: "A" });
    expect((await remainingIds()).sort()).toEqual(
      [otherUser, otherSize, otherColor, otherProduct, otherDesign].sort()
    );
  });
});
