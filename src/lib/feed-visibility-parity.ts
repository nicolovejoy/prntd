/**
 * Shop feed visibility parity: before-and-after read for moving the feed's
 * filter from `product.status = 'listed'` to `image_publication.is_hidden = 0`
 * (`getPublishedFeed` in src/lib/discover-feed.ts).
 *
 * `scripts/check-feed-visibility-parity.ts` is the CLI; this module is the
 * logic so it can be typechecked and run against a real libSQL database
 * (`__tests__/feed-visibility-parity.integration.test.ts`).
 *
 * Raw SQL over `@libsql/client`, SELECTs only. It reports two things:
 *
 *   - Disagreements: rows where `image_publication` and `product.status` say
 *     different things about one image. When the two tables agree, a
 *     publication with `is_hidden = 0` pairs with a `listed` composition, one
 *     with `is_hidden = 1` pairs with a `hidden` one, and a `draft`
 *     composition has no publication row.
 *   - The feed's image ids under the old filter and under the new one.
 *     Equal sets mean equal feeds: the dedupe per design, the ordering and
 *     the limit are applied to the same rows afterwards. Compared before any
 *     of those, so no limit hides a difference.
 *
 * The feed SQL below mirrors the joins in `getPublishedFeed` (product →
 * image on `front_image_id`, → user on `image.owner_id`). The two must stay
 * in step: change one, change the other.
 */
import type { Client } from "@libsql/client";

export type FeedVisibilityDisagreement = {
  /**
   * Which table the row was found from: "publication" is an
   * `image_publication` row whose composition is missing or has the wrong
   * status; "composition" is a non-draft `product` whose front image has no
   * publication row.
   */
  kind: "publication" | "composition";
  imageId: string;
  productId: string | null;
  productStatus: string | null;
  /** `image_publication.is_hidden`, or null when the image has no publication row. */
  isHidden: boolean | null;
  reason: string;
};

export type FeedVisibilityParityReport = {
  disagreements: FeedVisibilityDisagreement[];
  /** Image ids the feed's joins return under `product.status = 'listed'`, sorted. */
  oldFeedImageIds: string[];
  /** Image ids the feed's joins return under `image_publication.is_hidden = 0`, sorted. */
  newFeedImageIds: string[];
  onlyOld: string[];
  onlyNew: string[];
  /** True when the old and new lists are identical. */
  clean: boolean;
  counts: Record<string, number>;
};

const str = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v);

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// The feed's joins, as getPublishedFeed writes them. Keep in step with
// src/lib/discover-feed.ts.
const FEED_FROM = `from \`product\` p
  join \`image\` i on p.front_image_id = i.id
  join \`user\` u on u.id = i.owner_id`;

const OLD_FEED_SQL = `select i.id as image_id ${FEED_FROM} where p.status = 'listed'`;

const NEW_FEED_SQL = `select i.id as image_id ${FEED_FROM}
  join \`image_publication\` ip on ip.image_id = i.id
  where ip.is_hidden = 0`;

async function imageIds(client: Client, sql: string): Promise<string[]> {
  const res = await client.execute(sql);
  return res.rows.map((r) => String(r.image_id)).sort(byString);
}

export async function checkFeedVisibilityParity(
  client: Client
): Promise<FeedVisibilityParityReport> {
  const disagreements: FeedVisibilityDisagreement[] = [];

  // Every publication row against the composition that fronts its image.
  const publications = (
    await client.execute(
      `select ip.image_id, ip.is_hidden, p.id as product_id, p.status
         from \`image_publication\` ip
         left join \`product\` p on p.front_image_id = ip.image_id`
    )
  ).rows;
  for (const r of publications) {
    const imageId = String(r.image_id);
    const hidden = Number(r.is_hidden) === 1;
    const productId = str(r.product_id);
    const status = str(r.status);
    const expected = hidden ? "hidden" : "listed";
    if (productId === null) {
      disagreements.push({
        kind: "publication",
        imageId,
        productId,
        productStatus: null,
        isHidden: hidden,
        reason: `publication (is_hidden=${hidden ? 1 : 0}) has no composition fronted by this image`,
      });
    } else if (status !== expected) {
      disagreements.push({
        kind: "publication",
        imageId,
        productId,
        productStatus: status,
        isHidden: hidden,
        reason: `publication is_hidden=${hidden ? 1 : 0} expects status ${expected}, composition is ${status}`,
      });
    }
  }

  // Every non-draft composition against its image's publication row. A
  // composition with no front slot is skipped: the feed's join on the front
  // image cannot reach it either way.
  const orphans = (
    await client.execute(
      `select p.front_image_id as image_id, p.id as product_id, p.status
         from \`product\` p
         left join \`image_publication\` ip on ip.image_id = p.front_image_id
        where p.status <> 'draft'
          and p.front_image_id is not null
          and ip.image_id is null`
    )
  ).rows;
  for (const r of orphans) {
    const status = String(r.status);
    disagreements.push({
      kind: "composition",
      imageId: String(r.image_id),
      productId: String(r.product_id),
      productStatus: status,
      isHidden: null,
      reason: `composition is ${status} but its image has no image_publication row`,
    });
  }

  disagreements.sort(
    (a, b) => byString(a.imageId, b.imageId) || byString(a.kind, b.kind)
  );

  const oldFeedImageIds = await imageIds(client, OLD_FEED_SQL);
  const newFeedImageIds = await imageIds(client, NEW_FEED_SQL);
  const inNew = new Set(newFeedImageIds);
  const inOld = new Set(oldFeedImageIds);
  const onlyOld = oldFeedImageIds.filter((id) => !inNew.has(id));
  const onlyNew = newFeedImageIds.filter((id) => !inOld.has(id));

  const statusRows = (
    await client.execute(
      "select status, count(*) as n from `product` group by status"
    )
  ).rows;
  const byStatus = new Map(statusRows.map((r) => [String(r.status), Number(r.n)]));

  return {
    disagreements,
    oldFeedImageIds,
    newFeedImageIds,
    onlyOld,
    onlyNew,
    clean:
      oldFeedImageIds.length === newFeedImageIds.length &&
      oldFeedImageIds.every((id, i) => id === newFeedImageIds[i]),
    counts: {
      publications: publications.length,
      publicationsHidden: publications.filter((r) => Number(r.is_hidden) === 1)
        .length,
      compositions: statusRows.reduce((sum, r) => sum + Number(r.n), 0),
      compositionsListed: byStatus.get("listed") ?? 0,
      compositionsHidden: byStatus.get("hidden") ?? 0,
      compositionsDraft: byStatus.get("draft") ?? 0,
    },
  };
}
