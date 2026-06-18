/**
 * Pure helpers for the organizer pivot's Store object (Phase 1). No DB access —
 * slug derivation, share-link building, and access guards. The store table and
 * server actions live elsewhere; this is the testable logic the UI and actions
 * both call. Object model: docs/organizer-pivot-plan.md.
 */
import type { store } from "./db/schema";

type Store = typeof store.$inferSelect;

/**
 * Turn a shop name into a URL-safe slug. Strips emoji/punctuation, lowercases,
 * collapses whitespace to single hyphens, caps length. Empty input (e.g. a
 * name that's all emoji) falls back to "shop" so we never produce "".
 */
export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "") // drop emoji, punctuation, accents stripped by NFKD
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, ""); // a trailing hyphen can survive the slice
  return base || "shop";
}

/**
 * A unique slug for `name`, suffixing -2, -3, … until `isTaken` returns false.
 * Caller supplies the collision check (a Set lookup or a DB query). Pure given
 * the predicate.
 */
export function uniqueSlug(name: string, isTaken: (slug: string) => boolean): string {
  const base = slugify(name);
  if (!isTaken(base)) return base;
  let n = 2;
  while (isTaken(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * The public shop URL. Built from the request origin, NOT a hardcoded
 * NEXT_PUBLIC_APP_URL — otherwise a preview deploy's share link would point at
 * prod (the lesson from the checkout-bounces-to-prod bug).
 */
export function storeShareUrl(slug: string, origin: string): string {
  return new URL(`/shop/${slug}`, origin).toString();
}

/** Owner-only management guard. */
export function canManageStore(
  user: { id: string } | null | undefined,
  store: Pick<Store, "ownerId">
): boolean {
  return !!user && user.id === store.ownerId;
}

/** A store is publicly visible only when live (draft/hidden are owner-only). */
export function storeIsPublic(store: Pick<Store, "status">): boolean {
  return store.status === "live";
}

/** Can this viewer see the store? Public when live; owner sees any state. */
export function canViewStore(
  store: Pick<Store, "status" | "ownerId">,
  viewer: { id: string } | null | undefined
): boolean {
  return storeIsPublic(store) || (!!viewer && viewer.id === store.ownerId);
}
