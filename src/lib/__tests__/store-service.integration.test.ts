/**
 * Phase 2 store/product service, against a real in-memory libSQL built from the
 * live schema — slug uniqueness, ownership guards, ordering, and the
 * unowned-design rejection are exercised for real (the DB is injected, not
 * mocked).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import {
  createStore,
  getMyStores,
  getStoreById,
  updateStore,
  createProduct,
  getStoreProducts,
  addProductToStore,
  reorderProducts,
} from "@/lib/store-service";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let db: Db;

async function makeUser(id: string) {
  await db.insert(schema.user).values({ id, email: `${id}@example.com`, name: id });
}
async function makeDesign(userId: string) {
  const [d] = await db.insert(schema.design).values({ userId }).returning();
  return d;
}

beforeEach(async () => {
  db = await createTestDb();
});

describe("createStore", () => {
  it("creates a draft store with a slug derived from the name", async () => {
    await makeUser("org-1");
    const s = await createStore(db, "org-1", { name: "Manine's Club!" });
    expect(s.status).toBe("draft");
    expect(s.slug).toBe("manines-club");
    expect(s.ownerId).toBe("org-1");
  });

  it("suffixes the slug on collision", async () => {
    await makeUser("org-1");
    await makeUser("org-2");
    const a = await createStore(db, "org-1", { name: "Club" });
    const b = await createStore(db, "org-2", { name: "Club" });
    expect(a.slug).toBe("club");
    expect(b.slug).toBe("club-2");
  });

  it("rejects a blank name", async () => {
    await makeUser("org-1");
    await expect(createStore(db, "org-1", { name: "   " })).rejects.toThrow(/name/i);
  });

  it("lists an organizer's stores oldest-first", async () => {
    await makeUser("org-1");
    await createStore(db, "org-1", { name: "First" });
    await createStore(db, "org-1", { name: "Second" });
    const mine = await getMyStores(db, "org-1");
    expect(mine.map((s) => s.name)).toEqual(["First", "Second"]);
  });
});

describe("updateStore", () => {
  it("applies a partial update and keeps the slug stable on rename", async () => {
    await makeUser("org-1");
    const s = await createStore(db, "org-1", { name: "Club" });
    const updated = await updateStore(db, "org-1", s.id, {
      name: "The Club",
      status: "live",
      accentColor: "Navy",
    });
    expect(updated.name).toBe("The Club");
    expect(updated.status).toBe("live");
    expect(updated.accentColor).toBe("Navy");
    expect(updated.slug).toBe("club"); // unchanged
  });

  it("refuses a non-owner", async () => {
    await makeUser("org-1");
    await makeUser("org-2");
    const s = await createStore(db, "org-1", { name: "Club" });
    await expect(updateStore(db, "org-2", s.id, { name: "Hijack" })).rejects.toThrow(/unauthorized/i);
  });
});

describe("createProduct", () => {
  it("creates a draft product from an owned design", async () => {
    await makeUser("org-1");
    const design = await makeDesign("org-1");
    const store = await createStore(db, "org-1", { name: "Club" });
    const p = await createProduct(db, "org-1", {
      designId: design.id,
      blankId: "bella-canvas-3001",
      storeId: store.id,
      placements: { front_large: "img-1" },
    });
    expect(p.status).toBe("draft");
    expect(p.placements).toEqual({ front_large: "img-1" });
    expect(p.storeId).toBe(store.id);
  });

  it("rejects a design the organizer doesn't own", async () => {
    await makeUser("org-1");
    await makeUser("org-2");
    const design = await makeDesign("org-2");
    await expect(
      createProduct(db, "org-1", { designId: design.id, blankId: "bella-canvas-3001" })
    ).rejects.toThrow(/unauthorized/i);
  });

  it("allows a loose product with no store", async () => {
    await makeUser("org-1");
    const design = await makeDesign("org-1");
    const p = await createProduct(db, "org-1", {
      designId: design.id,
      blankId: "bella-canvas-3001",
    });
    expect(p.storeId).toBeNull();
  });
});

describe("ordering", () => {
  async function seedThree() {
    await makeUser("org-1");
    const store = await createStore(db, "org-1", { name: "Club" });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const d = await makeDesign("org-1");
      const p = await createProduct(db, "org-1", {
        designId: d.id,
        blankId: "bella-canvas-3001",
        storeId: store.id,
      });
      ids.push(p.id);
    }
    return { store, ids };
  }

  it("appends new products at increasing positions", async () => {
    const { store } = await seedThree();
    const products = await getStoreProducts(db, store.id);
    expect(products.map((p) => p.position)).toEqual([0, 1, 2]);
  });

  it("reorderProducts persists a new order", async () => {
    const { store, ids } = await seedThree();
    const reversed = [...ids].reverse();
    await reorderProducts(db, "org-1", store.id, reversed);
    const products = await getStoreProducts(db, store.id);
    expect(products.map((p) => p.id)).toEqual(reversed);
  });

  it("addProductToStore shelves a loose product at the end", async () => {
    await makeUser("org-1");
    const store = await createStore(db, "org-1", { name: "Club" });
    const d1 = await makeDesign("org-1");
    await createProduct(db, "org-1", { designId: d1.id, blankId: "bella-canvas-3001", storeId: store.id });
    const d2 = await makeDesign("org-1");
    const loose = await createProduct(db, "org-1", { designId: d2.id, blankId: "bella-canvas-3001" });

    const shelved = await addProductToStore(db, "org-1", loose.id, store.id);
    expect(shelved.storeId).toBe(store.id);
    expect(shelved.position).toBe(1);
  });
});

describe("getStoreById", () => {
  it("returns null for a missing store", async () => {
    expect(await getStoreById(db, "nope")).toBeNull();
  });
});
