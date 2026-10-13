/**
 * Shop feed visibility parity: before-and-after read for moving the feed's
 * filter from `product.status = 'listed'` to `image_publication.is_hidden = 0`
 * (`getPublishedFeed` in src/lib/discover-feed.ts).
 *
 * `scripts/check-feed-visibility-parity.ts` is the CLI; this module is the
 * logic so it can be typechecked and run against a real libSQL database
 * (`__tests__/feed-visibility-parity.integration.test.ts`).
 *
 * Raw SQL over `@libsql/client`, SELECTs only, in one read batch. It reports
 * two things:
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
 * It also reports what the feed does with a visible listing's conversation
 * (#321). `getPublishedFeed` returns a listing only when the image's
 * conversation id (`image.source_design_id`, else the design of its `output`
 * link) names an existing `design` row, because that is when the buy gate
 * lets a visitor order it. Two more lists come from the same read batch:
 *
 *   - `feedImageIds`: the image ids the feed now returns (visible, with a
 *     live conversation), before the dedupe per conversation and the limit.
 *   - `leftOutNoConversation`: the visible published listings the feed leaves
 *     out for lack of a conversation, with the conversation id that names
 *     nothing (null when the image has none). Expected, not a failure: these
 *     are the cards that leave the Shop. `clean` and `disagreements` do not
 *     count them.
 *
 * The feed SQL below mirrors the joins in `getPublishedFeed` (product →
 * image on `front_image_id`, → user on `image.owner_id`, → image_publication,
 * → design on the conversation id). The two must stay in step: change one,
 * change the other.
 */
import type { Client, ResultSet } from "@libsql/client";

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

/** A visible published listing the feed leaves out because it has no live conversation. */
export type FeedLeftOutListing = {
  imageId: string;
  productId: string;
  title: string | null;
  /** The conversation id that names no `design` row, or null when the image has none. */
  conversationId: string | null;
};

export type FeedVisibilityParityReport = {
  disagreements: FeedVisibilityDisagreement[];
  /** Image ids the feed's joins return under `product.status = 'listed'`, sorted. */
  oldFeedImageIds: string[];
  /** Image ids the feed's joins return under `image_publication.is_hidden = 0`, sorted. */
  newFeedImageIds: string[];
  onlyOld: string[];
  onlyNew: string[];
  /** Image ids the feed returns now: visible and with a live conversation, sorted. */
  feedImageIds: string[];
  /** Visible published listings the feed leaves out for lack of a conversation, by image id. */
  leftOutNoConversation: FeedLeftOutListing[];
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

// The image's conversation id, as getDesignImageWithOwner and getPublishedFeed
// derive it: source_design_id, else the design of its output link.
const CONVERSATION_ID = `coalesce(i.source_design_id, (select ci.design_id from \`conversation_image\` ci where ci.image_id = i.id and ci.role = 'output' limit 1))`;

// What getPublishedFeed returns, before its dedupe and limit: the new filter
// plus a live conversation.
const FEED_SQL = `select i.id as image_id ${FEED_FROM}
  join \`image_publication\` ip on ip.image_id = i.id
  join \`design\` d on d.id = ${CONVERSATION_ID}
  where ip.is_hidden = 0`;

// Visible listings the join on design drops.
const LEFT_OUT_SQL = `select i.id as image_id, p.id as product_id, p.title, ${CONVERSATION_ID} as conversation_id ${FEED_FROM}
  join \`image_publication\` ip on ip.image_id = i.id
  left join \`design\` d on d.id = ${CONVERSATION_ID}
  where ip.is_hidden = 0 and d.id is null`;

// Every publication row against the composition that fronts its image.
const PUBLICATIONS_SQL = `select ip.image_id, ip.is_hidden, p.id as product_id, p.status
  from \`image_publication\` ip
  left join \`product\` p on p.front_image_id = ip.image_id`;

// Every non-draft composition whose front image has no publication row. A
// composition with no front slot is skipped: the feed's join on the front
// image cannot reach it either way.
const ORPHANS_SQL = `select p.front_image_id as image_id, p.id as product_id, p.status
  from \`product\` p
  left join \`image_publication\` ip on ip.image_id = p.front_image_id
 where p.status <> 'draft'
   and p.front_image_id is not null
   and ip.image_id is null`;

const STATUS_SQL = "select status, count(*) as n from `product` group by status";

function imageIds(rows: ResultSet["rows"]): string[] {
  return rows.map((r) => String(r.image_id)).sort(byString);
}

export async function checkFeedVisibilityParity(
  client: Client
): Promise<FeedVisibilityParityReport> {
  // One read batch, so every statement sees the same snapshot: a publish or
  // hide on Production landing between separate statements could otherwise
  // fail the run for a row that was never out of step.
  const [
    publicationsRes,
    orphansRes,
    oldFeedRes,
    newFeedRes,
    statusRes,
    feedRes,
    leftOutRes,
  ] = await client.batch(
    [
      PUBLICATIONS_SQL,
      ORPHANS_SQL,
      OLD_FEED_SQL,
      NEW_FEED_SQL,
      STATUS_SQL,
      FEED_SQL,
      LEFT_OUT_SQL,
    ],
    "read"
  );

  const disagreements: FeedVisibilityDisagreement[] = [];

  const publications = publicationsRes.rows;
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

  for (const r of orphansRes.rows) {
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

  const oldFeedImageIds = imageIds(oldFeedRes.rows);
  const newFeedImageIds = imageIds(newFeedRes.rows);
  const inNew = new Set(newFeedImageIds);
  const inOld = new Set(oldFeedImageIds);
  const onlyOld = oldFeedImageIds.filter((id) => !inNew.has(id));
  const onlyNew = newFeedImageIds.filter((id) => !inOld.has(id));

  const statusRows = statusRes.rows;
  const byStatus = new Map(statusRows.map((r) => [String(r.status), Number(r.n)]));

  return {
    disagreements,
    oldFeedImageIds,
    newFeedImageIds,
    onlyOld,
    onlyNew,
    feedImageIds: imageIds(feedRes.rows),
    leftOutNoConversation: leftOutRes.rows
      .map((r) => ({
        imageId: String(r.image_id),
        productId: String(r.product_id),
        title: str(r.title),
        conversationId: str(r.conversation_id),
      }))
      .sort((a, b) => byString(a.imageId, b.imageId)),
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
