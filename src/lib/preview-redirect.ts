/**
 * Where an old `/preview` link goes now (#278 slice 4). `/preview` was the
 * design-your-own buy page; the image detail page replaced it. Links to it
 * outlive the page: Stripe cancel and Back links from sessions created before
 * the deploy, `/order?…` (which forwards here), sign-in `next=` values,
 * bookmarks. Each lands on the image detail page of the image it showed, with
 * the panel open and the same picks.
 *
 * This only chooses a page. Who may buy, and which back may print, stay the
 * page's decisions (`resolveBuyableImage`, `resolveInitialBack`); a stale or
 * forged link opens a page that refuses what it must.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversationImage, design as designTable } from "@/lib/db/schema";
import {
  buyPageHref,
  parseBuyPagePicks,
  parseIdParam,
} from "@/lib/buy-page-picks";
import { withNext } from "@/lib/safe-next";

type Search = Record<string, string | string[] | undefined>;

export type PreviewLink = {
  designId: string | null;
  front: string | null;
  back: string | null;
  product: string | null;
  size: string | null;
  color: string | null;
};

/** The parameters `/preview` read, validated the way the image page validates its own. */
export function parsePreviewLink(search: Search): PreviewLink {
  const picks = parseBuyPagePicks({
    product: search.product,
    size: search.size,
    color: search.color,
    back: search.back,
  });
  return {
    designId: parseIdParam(search.id),
    front: parseIdParam(search.front),
    back: picks.back,
    product: picks.product,
    size: picks.size,
    color: picks.color,
  };
}

/** The `/preview` link rebuilt from the parsed values only, for the sign-in detour. */
export function previewPath(link: PreviewLink): string {
  const params = new URLSearchParams();
  const entries: [string, string | null][] = [
    ["id", link.designId],
    ["front", link.front],
    ["back", link.back],
    ["product", link.product],
    ["size", link.size],
    ["color", link.color],
  ];
  for (const [key, value] of entries) if (value) params.set(key, value);
  const qs = params.toString();
  return qs ? `/preview?${qs}` : "/preview";
}

/**
 * The decision, given what the DB said. `inConversation` holds which of the
 * front (or primary) and back are images of the link's conversation.
 *
 *  - no conversation id: `/design`, as `/preview` did;
 *  - signed out: sign-in, coming back to this same link;
 *  - a viewer who does not own the conversation: the front's page if the link
 *    names one (the page shows a published image and 404s a private one),
 *    else `/design`. The conversation's primary is never revealed;
 *  - the owner: the front's page, or the primary's; `/design?id=` when there
 *    is neither, as `/preview` did. A swapped link (front from elsewhere, back
 *    from this conversation) opens the back's page with `swap=1`: the same
 *    shirt, ordered on the conversation the link named.
 */
export function previewRedirectTarget(params: {
  link: PreviewLink;
  viewer: "none" | "other" | "owner";
  primaryImageId: string | null;
  inConversation: ReadonlySet<string>;
}): string {
  const { link, viewer, primaryImageId, inConversation } = params;
  if (!link.designId) return "/design";
  if (viewer === "none") return withNext("/sign-in", previewPath(link));

  const picks = {
    order: true,
    product: link.product,
    size: link.size,
    color: link.color,
  };

  if (viewer === "other") {
    if (!link.front) return "/design";
    const back = link.back && link.back !== link.front ? link.back : null;
    return buyPageHref(link.front, { ...picks, back });
  }

  const front = link.front ?? primaryImageId;
  if (!front) return `/design?id=${link.designId}`;
  const back = link.back && link.back !== front ? link.back : null;
  if (back && !inConversation.has(front) && inConversation.has(back)) {
    return buyPageHref(back, { ...picks, back: front, swap: true });
  }
  return buyPageHref(front, { ...picks, back });
}

/** Read what the decision needs and make it. */
export async function resolvePreviewRedirect(
  search: Search,
  viewerId: string | null
): Promise<string> {
  const link = parsePreviewLink(search);
  const none = new Set<string>();
  if (!link.designId) {
    return previewRedirectTarget({ link, viewer: "none", primaryImageId: null, inConversation: none });
  }
  if (!viewerId) {
    return previewRedirectTarget({ link, viewer: "none", primaryImageId: null, inConversation: none });
  }

  const [row] = await db
    .select({ userId: designTable.userId, primaryImageId: designTable.primaryImageId })
    .from(designTable)
    .where(eq(designTable.id, link.designId))
    .limit(1);
  if (!row || row.userId !== viewerId) {
    return previewRedirectTarget({ link, viewer: "other", primaryImageId: null, inConversation: none });
  }

  const front = link.front ?? row.primaryImageId;
  const candidates = [front, link.back].filter((v): v is string => Boolean(v));
  const linked =
    candidates.length > 0
      ? await db
          .select({ imageId: conversationImage.imageId })
          .from(conversationImage)
          .where(
            and(
              eq(conversationImage.designId, link.designId),
              inArray(conversationImage.imageId, candidates)
            )
          )
      : [];
  return previewRedirectTarget({
    link,
    viewer: "owner",
    primaryImageId: row.primaryImageId,
    inConversation: new Set(linked.map((r) => r.imageId)),
  });
}
