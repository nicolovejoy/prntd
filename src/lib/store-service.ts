/**
 * Store + product persistence for the organizer pivot (Phase 2). The DB handle
 * is injected so these run against the real in-memory test DB in integration
 * tests and the live `db` in the server actions — no mocking, no auth/headers
 * coupling. Pure slug/guard logic lives in `stores.ts`; this is the data layer.
 */
import { eq, asc } from "drizzle-orm";
import {
  store as storeTable,
  product as productTable,
  design as designTable,
} from "./db/schema";
import { uniqueSlug, canManageStore } from "./stores";
import type { db as appDb } from "./db";

type DB = typeof appDb;
type Store = typeof storeTable.$inferSelect;
type Product = typeof productTable.$inferSelect;

export type CreateStoreInput = {
  name: string;
  description?: string | null;
  accentColor?: string | null;
};

/** Insert a draft store with a globally-unique slug derived from the name. */
export async function createStore(
  db: DB,
  ownerId: string,
  input: CreateStoreInput
): Promise<Store> {
  const name = input.name.trim();
  if (!name) throw new Error("Store name is required");

  // Resolve a unique slug: read existing slugs once, suffix -2/-3/… on clash.
  const existing = await db.select({ slug: storeTable.slug }).from(storeTable);
  const taken = new Set(existing.map((r) => r.slug));
  const slug = uniqueSlug(name, (s) => taken.has(s));

  const [created] = await db
    .insert(storeTable)
    .values({
      ownerId,
      slug,
      name,
      description: input.description ?? null,
      accentColor: input.accentColor ?? null,
    })
    .returning();
  return created;
}

/** All of an organizer's stores, oldest first (defaults to the single store). */
export async function getMyStores(db: DB, ownerId: string): Promise<Store[]> {
  return db
    .select()
    .from(storeTable)
    .where(eq(storeTable.ownerId, ownerId))
    .orderBy(asc(storeTable.createdAt));
}

export async function getStoreById(db: DB, storeId: string): Promise<Store | null> {
  const [s] = await db.select().from(storeTable).where(eq(storeTable.id, storeId));
  return s ?? null;
}

export async function getStoreBySlug(db: DB, slug: string): Promise<Store | null> {
  const [s] = await db.select().from(storeTable).where(eq(storeTable.slug, slug));
  return s ?? null;
}

export type UpdateStoreInput = Partial<{
  name: string;
  description: string | null;
  accentColor: string | null;
  status: Store["status"];
}>;

/** Owner-guarded partial update. Slug stays stable across a rename. */
export async function updateStore(
  db: DB,
  ownerId: string,
  storeId: string,
  patch: UpdateStoreInput
): Promise<Store> {
  const current = await getStoreById(db, storeId);
  if (!current) throw new Error("Store not found");
  if (!canManageStore({ id: ownerId }, current)) throw new Error("Unauthorized");

  const set: Partial<typeof storeTable.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.accentColor !== undefined) set.accentColor = patch.accentColor;
  if (patch.status !== undefined) set.status = patch.status;

  const [updated] = await db
    .update(storeTable)
    .set(set)
    .where(eq(storeTable.id, storeId))
    .returning();
  return updated;
}

export type CreateProductInput = {
  designId: string;
  blankId: string;
  storeId?: string | null;
  placements?: Record<string, string> | null;
  price?: number | null;
};

/**
 * Create a draft product from one of the organizer's own designs. Rejects a
 * design the organizer doesn't own (the ownership guard the compose UI relies
 * on). New products land at the end of their store's order.
 */
export async function createProduct(
  db: DB,
  ownerId: string,
  input: CreateProductInput
): Promise<Product> {
  const [design] = await db
    .select({ userId: designTable.userId })
    .from(designTable)
    .where(eq(designTable.id, input.designId));
  if (!design) throw new Error("Design not found");
  if (design.userId !== ownerId) throw new Error("Unauthorized");

  if (input.storeId) await assertOwnsStore(db, ownerId, input.storeId);

  const position = input.storeId
    ? await nextPosition(db, input.storeId)
    : 0;

  const [created] = await db
    .insert(productTable)
    .values({
      ownerId,
      storeId: input.storeId ?? null,
      designId: input.designId,
      blankId: input.blankId,
      placements: input.placements ?? null,
      price: input.price ?? null,
      position,
    })
    .returning();
  return created;
}

export async function getProductById(db: DB, productId: string): Promise<Product | null> {
  const [p] = await db.select().from(productTable).where(eq(productTable.id, productId));
  return p ?? null;
}

export type UpdateProductInput = Partial<{
  blankId: string;
  placements: Record<string, string> | null;
  price: number | null;
  status: Product["status"];
}>;

/**
 * Owner-guarded partial update of a draft/listed product — the compose form's
 * save. Only the composable fields (blank, placements, price, status) move;
 * designId, storeId and position are managed elsewhere (createProduct,
 * addProductToStore, reorderProducts).
 */
export async function updateProduct(
  db: DB,
  ownerId: string,
  productId: string,
  patch: UpdateProductInput
): Promise<Product> {
  await assertOwnsProduct(db, ownerId, productId);

  const set: Partial<typeof productTable.$inferInsert> = { updatedAt: new Date() };
  if (patch.blankId !== undefined) set.blankId = patch.blankId;
  if (patch.placements !== undefined) set.placements = patch.placements;
  if (patch.price !== undefined) set.price = patch.price;
  if (patch.status !== undefined) set.status = patch.status;

  const [updated] = await db
    .update(productTable)
    .set(set)
    .where(eq(productTable.id, productId))
    .returning();
  return updated;
}

/** Products shelved in a store, in display order. */
export async function getStoreProducts(db: DB, storeId: string): Promise<Product[]> {
  return db
    .select()
    .from(productTable)
    .where(eq(productTable.storeId, storeId))
    .orderBy(asc(productTable.position));
}

/** Move a loose (or other-store) product onto a store, at the end. */
export async function addProductToStore(
  db: DB,
  ownerId: string,
  productId: string,
  storeId: string
): Promise<Product> {
  await assertOwnsStore(db, ownerId, storeId);
  const product = await assertOwnsProduct(db, ownerId, productId);
  const position = await nextPosition(db, storeId);
  const [updated] = await db
    .update(productTable)
    .set({ storeId, position, updatedAt: new Date() })
    .where(eq(productTable.id, product.id))
    .returning();
  return updated;
}

/**
 * Persist a new product order within a store. `orderedIds` is the full set of
 * the store's product ids in the desired order; each gets its index as
 * `position`. Ids not owned by the organizer or not in the store are ignored.
 */
export async function reorderProducts(
  db: DB,
  ownerId: string,
  storeId: string,
  orderedIds: string[]
): Promise<void> {
  await assertOwnsStore(db, ownerId, storeId);
  const inStore = await getStoreProducts(db, storeId);
  const valid = new Set(inStore.map((p) => p.id));
  let position = 0;
  for (const id of orderedIds) {
    if (!valid.has(id)) continue;
    await db
      .update(productTable)
      .set({ position, updatedAt: new Date() })
      .where(eq(productTable.id, id));
    position++;
  }
}

// --- internal guards ---

async function assertOwnsStore(db: DB, ownerId: string, storeId: string): Promise<Store> {
  const s = await getStoreById(db, storeId);
  if (!s) throw new Error("Store not found");
  if (!canManageStore({ id: ownerId }, s)) throw new Error("Unauthorized");
  return s;
}

async function assertOwnsProduct(db: DB, ownerId: string, productId: string): Promise<Product> {
  const [p] = await db.select().from(productTable).where(eq(productTable.id, productId));
  if (!p) throw new Error("Product not found");
  if (p.ownerId !== ownerId) throw new Error("Unauthorized");
  return p;
}

async function nextPosition(db: DB, storeId: string): Promise<number> {
  const rows = await getStoreProducts(db, storeId);
  return rows.length;
}
