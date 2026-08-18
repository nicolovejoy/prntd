/**
 * Composition slice 1 backfill core (docs/composition-first-class-plan.md §4).
 *
 * Converts every `listing` row without a mirror `product` row into one, with
 * the same field mapping as the publish dual-write (model-b-writes.ts
 * productMirrorStatement) except that existing moderation/curation state is
 * carried over: `status = isHidden ? "hidden" : "listed"`, `feedRank` kept,
 * `listedAt = publishedAt`.
 *
 * The DB handle is injected so the same code path runs against the real
 * in-memory test DB and — via scripts/backfill-composition-products.ts —
 * against a live database. Idempotent: a mirror is identified by
 * `storeId IS NULL AND designId IS NULL AND placements = {front: imageId}`,
 * so a re-run finds every mirror already present and creates nothing.
 */
import { and, inArray, isNull } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import {
  listing as listingTable,
  image as imageTable,
  product as productTable,
} from "@/lib/db/schema";
import { buildMirrorProductRow, mirrorPlacements } from "@/lib/model-b-writes";

type DB = typeof appDb;

export type CompositionBackfillSummary = {
  /** Total listing rows scanned. */
  listings: number;
  /** Listings that already had a mirror product (skipped). */
  mirrorsFound: number;
  /** Mirrors created (apply) or that would be created (dry run). */
  mirrorsCreated: number;
  /** Listing imageIds whose `image` row is missing — no owner to assign,
   * skipped and reported. */
  missingImageIds: string[];
};

export async function backfillCompositionMirrors(
  db: DB,
  opts: { apply: boolean }
): Promise<CompositionBackfillSummary> {
  const listings = await db.select().from(listingTable);
  const summary: CompositionBackfillSummary = {
    listings: listings.length,
    mirrorsFound: 0,
    mirrorsCreated: 0,
    missingImageIds: [],
  };
  if (listings.length === 0) return summary;

  const imageIds = listings.map((l) => l.imageId);
  const owners = new Map(
    (
      await db
        .select({ id: imageTable.id, ownerId: imageTable.ownerId })
        .from(imageTable)
        .where(inArray(imageTable.id, imageIds))
    ).map((r) => [r.id, r.ownerId])
  );

  // Existing mirrors: candidates are storeId+designId NULL; a row counts as
  // image X's mirror when its placements are exactly { front: X }.
  const candidates = await db
    .select({ id: productTable.id, placements: productTable.placements })
    .from(productTable)
    .where(and(isNull(productTable.storeId), isNull(productTable.designId)));
  const mirrored = new Set<string>();
  for (const c of candidates) {
    const entries = Object.entries(c.placements ?? {});
    if (entries.length === 1 && entries[0][0] === "front") {
      mirrored.add(entries[0][1]);
    }
  }

  for (const l of listings) {
    if (mirrored.has(l.imageId)) {
      summary.mirrorsFound++;
      continue;
    }
    const ownerId = owners.get(l.imageId);
    if (!ownerId) {
      summary.missingImageIds.push(l.imageId);
      continue;
    }
    if (opts.apply) {
      await db.insert(productTable).values(
        buildMirrorProductRow({
          imageId: l.imageId,
          ownerId,
          listedAt: l.publishedAt,
          title: l.title,
          description: l.description,
          backdropColor: l.backgroundColor,
          feedRank: l.feedRank,
          status: l.isHidden ? "hidden" : "listed",
        })
      );
    }
    summary.mirrorsCreated++;
  }
  return summary;
}

/**
 * Post-run verification: for every listing, is there exactly one mirror and
 * do its mirrored fields match? Returns human-readable mismatch lines
 * (empty = clean). Reads only.
 */
export async function verifyCompositionMirrors(db: DB): Promise<string[]> {
  const listings = await db.select().from(listingTable);
  const candidates = await db
    .select()
    .from(productTable)
    .where(and(isNull(productTable.storeId), isNull(productTable.designId)));

  const byImage = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const entries = Object.entries(c.placements ?? {});
    if (entries.length === 1 && entries[0][0] === "front") {
      const list = byImage.get(entries[0][1]) ?? [];
      list.push(c);
      byImage.set(entries[0][1], list);
    }
  }

  const problems: string[] = [];
  for (const l of listings) {
    const mirrors = byImage.get(l.imageId) ?? [];
    if (mirrors.length === 0) {
      problems.push(`listing ${l.imageId}: no mirror product`);
      continue;
    }
    if (mirrors.length > 1) {
      problems.push(
        `listing ${l.imageId}: ${mirrors.length} mirror products (expected 1)`
      );
      continue;
    }
    const m = mirrors[0];
    const expectedStatus = l.isHidden ? "hidden" : "listed";
    if (m.status !== expectedStatus) {
      problems.push(
        `listing ${l.imageId}: mirror status ${m.status}, expected ${expectedStatus}`
      );
    }
    if (m.title !== l.title) {
      problems.push(`listing ${l.imageId}: mirror title mismatch`);
    }
    if (m.backdropColor !== l.backgroundColor) {
      problems.push(`listing ${l.imageId}: mirror backdropColor mismatch`);
    }
    if ((m.feedRank ?? null) !== (l.feedRank ?? null)) {
      problems.push(`listing ${l.imageId}: mirror feedRank mismatch`);
    }
    if (JSON.stringify(m.placements) !== JSON.stringify(mirrorPlacements(l.imageId))) {
      problems.push(`listing ${l.imageId}: mirror placements mismatch`);
    }
  }
  return problems;
}
