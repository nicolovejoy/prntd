/**
 * Who a shirt is attributed to.
 *
 * The contributor set of a shirt is the distinct owners of its placement
 * images, ordered front-first (composition plan §3). It is derived at read
 * time from `placements` → `image.ownerId`, never from `order.designId` /
 * `order_item.designId` — those name the conversation the purchase happened
 * in, which gives the wrong answer the moment one shirt carries two owners'
 * images.
 *
 * Pure so the rules are unit-tested independently of the order queries.
 */

/** One owner of a placement image. `name` is null when the user row has none. */
export type Contributor = { userId: string; name: string | null };

/**
 * The placement image ids of one line, front first, then the remaining
 * placement keys in their JSON order. Duplicates collapse (the same image on
 * front and back is one id).
 */
export function placementImageIds(
  placements: Record<string, string> | null | undefined
): string[] {
  if (!placements) return [];
  const ids: string[] = [];
  const push = (value: string | undefined) => {
    if (value && !ids.includes(value)) ids.push(value);
  };
  push(placements.front);
  for (const [key, value] of Object.entries(placements)) {
    if (key !== "front") push(value);
  }
  return ids;
}

/**
 * Distinct placement-image owners, front-first.
 *
 * `fallback` is the conversation's owner, used only when no placement image
 * resolves to an owner — a legacy line with no placements JSON, or one whose
 * pin is a placement render rather than an artifact. Historical orders keep
 * the attribution they have always shown.
 */
export function resolveContributors(params: {
  placements: Record<string, string> | null;
  ownerByImageId: Map<string, Contributor>;
  fallback?: Contributor | null;
}): Contributor[] {
  const contributors: Contributor[] = [];
  for (const imageId of placementImageIds(params.placements)) {
    const owner = params.ownerByImageId.get(imageId);
    if (!owner) continue;
    if (contributors.some((c) => c.userId === owner.userId)) continue;
    contributors.push(owner);
  }
  if (contributors.length === 0 && params.fallback) return [params.fallback];
  return contributors;
}

/**
 * The names to render after "Designed by", or null to show nothing.
 *
 * The viewer is dropped from the set — "designed by you" is noise, and with
 * two contributors that leaves the other name alone rather than "you & X".
 * A contributor with no name is skipped rather than rendered blank; if that
 * empties the set, the line disappears. The seller never appears here: only
 * contributors do.
 */
export function contributorAttribution(params: {
  contributors: Contributor[];
  viewerId: string | null;
}): string | null {
  const names = params.contributors
    .filter((c) => c.userId !== params.viewerId)
    .map((c) => c.name)
    .filter((name): name is string => Boolean(name));
  if (names.length === 0) return null;
  return names.join(" & ");
}

/**
 * Single-contributor shorthand, kept for the order header (which still names
 * the conversation's owner) — delegates to the rule above.
 */
export function designerAttribution(params: {
  designerId: string | null;
  designerName: string | null;
  buyerId: string;
}): string | null {
  const { designerId, designerName, buyerId } = params;
  if (!designerId) return null;
  return contributorAttribution({
    contributors: [{ userId: designerId, name: designerName }],
    viewerId: buyerId,
  });
}
