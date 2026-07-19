/**
 * Phase 1 store/product schema, against a real (in-memory) libSQL built from
 * the live schema — so slug uniqueness, FK constraints, JSON round-trips, and
 * the guest→account re-parent are exercised for real, not mocked.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import { makeUser, makeDesign } from "./factories";
import * as schema from "@/lib/db/schema";

type Db = Awaited<ReturnType<typeof createTestDb>>;

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

describe("store table", () => {
  it("creates a store with status defaulting to draft", async () => {
    await makeUser(db, "org-1");
    const [s] = await db
      .insert(schema.store)
      .values({ ownerId: "org-1", slug: "manines-club", name: "Manine's Club" })
      .returning();
    expect(s.status).toBe("draft");
    expect(s.id).toBeTruthy();
  });

  it("enforces unique slugs across owners", async () => {
    await makeUser(db, "org-1");
    await makeUser(db, "org-2");
    await db.insert(schema.store).values({ ownerId: "org-1", slug: "dup", name: "A" });
    await expect(
      db.insert(schema.store).values({ ownerId: "org-2", slug: "dup", name: "B" })
    ).rejects.toThrow();
  });

  it("allows many stores per organizer (no ownerId uniqueness)", async () => {
    await makeUser(db, "org-1");
    await db.insert(schema.store).values({ ownerId: "org-1", slug: "club", name: "Club" });
    await db.insert(schema.store).values({ ownerId: "org-1", slug: "band", name: "Band" });
    const rows = await db.select().from(schema.store).where(eq(schema.store.ownerId, "org-1"));
    expect(rows).toHaveLength(2);
  });
});

describe("product table", () => {
  it("persists placements JSON and links design + store", async () => {
    await makeUser(db, "org-1");
    const design = await makeDesign(db, "org-1");
    const [store] = await db
      .insert(schema.store)
      .values({ ownerId: "org-1", slug: "club", name: "Club" })
      .returning();
    const [p] = await db
      .insert(schema.product)
      .values({
        ownerId: "org-1",
        storeId: store.id,
        designId: design.id,
        blankId: "bella-canvas-3001",
        placements: { front_large: "img-123", back: "img-456" },
      })
      .returning();
    expect(p.status).toBe("draft");
    expect(p.placements).toEqual({ front_large: "img-123", back: "img-456" });
  });

  it("allows a loose product (no store) before it's shelved", async () => {
    await makeUser(db, "org-1");
    const design = await makeDesign(db, "org-1");
    const [p] = await db
      .insert(schema.product)
      .values({ ownerId: "org-1", designId: design.id, blankId: "bella-canvas-3001" })
      .returning();
    expect(p.storeId).toBeNull();
  });

  it("rejects a product whose design FK doesn't exist", async () => {
    await makeUser(db, "org-1");
    await expect(
      db
        .insert(schema.product)
        .values({ ownerId: "org-1", designId: "nope", blankId: "bella-canvas-3001" })
    ).rejects.toThrow();
  });
});

describe("guest → account claim re-parents store + product", () => {
  it("moves both to the real account by ownerId (what onLinkAccount runs)", async () => {
    await makeUser(db, "guest");
    await makeUser(db, "real");
    const design = await makeDesign(db, "guest");
    await db.insert(schema.store).values({ ownerId: "guest", slug: "club", name: "Club" });
    await db
      .insert(schema.product)
      .values({ ownerId: "guest", designId: design.id, blankId: "bella-canvas-3001" });

    await db.update(schema.store).set({ ownerId: "real" }).where(eq(schema.store.ownerId, "guest"));
    await db
      .update(schema.product)
      .set({ ownerId: "real" })
      .where(eq(schema.product.ownerId, "guest"));

    const stores = await db.select().from(schema.store).where(eq(schema.store.ownerId, "real"));
    const products = await db.select().from(schema.product).where(eq(schema.product.ownerId, "real"));
    expect(stores).toHaveLength(1);
    expect(products).toHaveLength(1);
  });
});

describe("product_offering availability window", () => {
  it("persists a dated offering", async () => {
    const [o] = await db
      .insert(schema.productOffering)
      .values({
        name: "Holiday Mugs",
        availableFrom: new Date("2026-11-01"),
        availableUntil: new Date("2027-01-01"),
      })
      .returning();
    expect(o.name).toBe("Holiday Mugs");
    expect(o.availableUntil).toBeInstanceOf(Date);
  });
});
