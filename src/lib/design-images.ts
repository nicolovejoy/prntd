/**
 * Image reads + the image write choke point.
 *
 * Slices 2+4 of the Model B migration (docs/model-b-migration-plan.md): every
 * read resolves against the new tables — `image` + `conversation_image` for
 * source artifacts, `placement_render` for the render cache, `listing` for
 * publish state — and since the slice-4 writer cutover, writes land ONLY those
 * shapes. `design_image` is write-dead (deletes of legacy rows excepted, until
 * slice 5 drops the table).
 *
 * Id reuse (§2) is what makes the swap invisible to callers: a pinned
 * placement id resolves whether it was minted as an artifact or a render, which
 * is why the id lookups check both tables (resolveImagesByIds).
 */
import { db } from "@/lib/db";
import {
  design as designTable,
  designImage as designImageTable,
  chatMessage as chatMessageTable,
  cartItem as cartItemTable,
  product as productTable,
  image as imageTable,
  conversationImage as conversationImageTable,
  placementRender as placementRenderTable,
  listing as listingTable,
  type ChatMessage,
} from "@/lib/db/schema";
import { eq, ne, and, asc, desc, inArray, sql } from "drizzle-orm";
import { imageReferences } from "@/lib/design-publish";
import { getBlank, type AspectRatio } from "@/lib/blanks";
import {
  buildImageRow,
  buildOutputLinkRow,
  buildPlacementRenderRow,
} from "@/lib/model-b-writes";

// created_at is second-resolution, so rows written in the same second tie.
// rowid breaks the tie by insert order — which is what the old design_image
// reads got implicitly from the table scan.
const IMAGE_SEQ_ASC = sql`image.rowid asc`;
const IMAGE_SEQ_DESC = sql`image.rowid desc`;
const RENDER_SEQ_ASC = sql`placement_render.rowid asc`;
const RENDER_SEQ_DESC = sql`placement_render.rowid desc`;

/**
 * Atomically reserve `count` generation numbers for a design in a single
 * `UPDATE ... RETURNING`, returning the reserved numbers ascending.
 *
 * Since the slice-4 writer cutover this is purely the display counter
 * (/designs cards show "N generations"; the action responses echo the
 * number). R2 keys are id-keyed (`images/{imageId}.png`, minted before
 * upload) and no longer derive from it — kept atomic anyway so concurrent
 * generates don't undercount. Gaps from failed generations are harmless.
 */
export async function reserveGenerationNumbers(
  designId: string,
  count: number
): Promise<number[]> {
  const [row] = await db
    .update(designTable)
    .set({ generationCount: sql`${designTable.generationCount} + ${count}` })
    .where(eq(designTable.id, designId))
    .returning({ generationCount: designTable.generationCount });
  if (!row) throw new Error("Design not found");
  const end = row.generationCount;
  const start = end - count + 1;
  return Array.from({ length: count }, (_, i) => start + i);
}

export type DesignImage = {
  id: string;
  number: number;
  url: string;
  prompt: string;
  publishedAt: Date | null;
  /** How the image is linked to the thread. A `seed` (fresh-start source,
   * slice 3) belongs to another conversation — it can anchor generations and
   * products but is never a provenance parent and is only detached, not
   * deleted, from this thread. Absent = output (legacy callers). */
  role?: "output" | "seed";
};

/**
 * Fetch chat messages for a design, ordered oldest → newest.
 */
export async function getDesignMessages(
  designId: string
): Promise<ChatMessage[]> {
  return await db
    .select()
    .from(chatMessageTable)
    .where(eq(chatMessageTable.designId, designId))
    .orderBy(asc(chatMessageTable.createdAt));
}

/**
 * Insert a chat message row. Append-only — never updates existing rows.
 */
export async function insertChatMessage(params: {
  designId: string;
  role: "user" | "assistant";
  content: string;
  imageId?: string | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(chatMessageTable).values({
    id,
    designId: params.designId,
    role: params.role,
    content: params.content,
    imageId: params.imageId ?? null,
  });
  return id;
}

/**
 * Source images for a design with the AI-context shape the prompt
 * builder wants (number, url, prompt). Numbers are 1-indexed in
 * chronological order. Used by sendChatMessage / generateDesign /
 * constructFluxPrompt to populate the "Images so far" gallery
 * context. Uploads stored with prompt='[user upload] ...' surface as-is.
 * Includes the thread's seed image (fresh-start, slice 3) so the AI can
 * reference the starting point from turn one.
 */
export async function getDesignImagesForAIContext(
  designId: string
): Promise<DesignImage[]> {
  const sources = await getDesignSourceImages(designId, { includeSeeds: true });
  return sources.map((s, i) => ({
    id: s.id,
    number: i + 1,
    url: s.imageUrl,
    prompt: s.prompt ?? "",
    publishedAt: s.publishedAt,
    role: s.role,
  }));
}

/**
 * Insert a new image (or placement render) for a generation — the write choke
 * point. Since the slice-4 writer cutover this writes ONLY the Model B shapes:
 * `image` + `conversation_image(role=output)` for source artifacts,
 * `placement_render` for product-targeted renders. Automatically links
 * `parentImageId` to the most recent existing image for the same design,
 * forming the provenance chain.
 */
export async function insertDesignImage(params: {
  designId: string;
  imageUrl: string;
  aspectRatio: AspectRatio;
  prompt?: string | null;
  generationCost: number;
  productId?: string | null;
  placementId?: string | null;
  /** Explicit anchor. For placement renders (#25) this is the source image the
   * render was generated from, so a later lookup can match the exact pick.
   * Omitted for chat-driven generations → defaults to the latest thread image. */
  parentImageId?: string | null;
  /** Pre-minted row id. Callers that upload to the id-keyed R2 path
   * (`images/{id}.png`) mint the id first and pass it here so the row and the
   * object key agree. Omitted → a fresh UUID. */
  id?: string;
}): Promise<string> {
  let parentImageId = params.parentImageId ?? null;
  if (parentImageId === null) {
    // Latest artifact in the thread. Renders are excluded (they live in
    // placement_render now) — the provenance chain is between artifacts.
    const latest = await db
      .select({ id: imageTable.id })
      .from(conversationImageTable)
      .innerJoin(imageTable, eq(imageTable.id, conversationImageTable.imageId))
      .where(
        and(
          eq(conversationImageTable.designId, params.designId),
          eq(conversationImageTable.role, "output")
        )
      )
      .orderBy(desc(imageTable.createdAt), IMAGE_SEQ_DESC)
      .limit(1);
    parentImageId = latest[0]?.id ?? null;
  }

  const id = params.id ?? crypto.randomUUID();
  const productId = params.productId ?? null;

  // A row with product_id set is a placement render (cache) →
  // placement_render; otherwise it's a source artifact → image + output link.
  if (productId !== null) {
    await db.insert(placementRenderTable).values(
      buildPlacementRenderRow({
        id,
        designId: params.designId,
        sourceImageId: parentImageId,
        blankId: productId,
        placementId: params.placementId,
        imageUrl: params.imageUrl,
        aspectRatio: params.aspectRatio,
        generationCost: params.generationCost,
      })
    );
  } else {
    const [owner] = await db
      .select({
        userId: designTable.userId,
        // Seeded-thread attribution (slice 3): every artifact the thread
        // produces carries the seed lineage, matching the slice-1 backfill.
        forkedFromImageId: designTable.forkedFromImageId,
        originalDesignerId: designTable.originalDesignerId,
      })
      .from(designTable)
      .where(eq(designTable.id, params.designId))
      .limit(1);
    if (!owner) throw new Error("Design not found");
    await db.batch([
      db.insert(imageTable).values(
        buildImageRow({
          id,
          ownerId: owner.userId,
          designId: params.designId,
          imageUrl: params.imageUrl,
          aspectRatio: params.aspectRatio,
          prompt: params.prompt,
          generationCost: params.generationCost,
          parentImageId,
          seedImageId: owner.forkedFromImageId,
          originalDesignerId: owner.originalDesignerId,
        })
      ),
      db.insert(conversationImageTable).values(buildOutputLinkRow(params.designId, id)),
    ]);
  }
  return id;
}

/**
 * Look up an existing placement-targeted render for a design. Used as
 * a cache-hit short-circuit so re-clicking the same product doesn't
 * re-spend Replicate credits.
 *
 * Returns the most recent matching row (latest wins if there are
 * multiple, which can happen if an earlier rewrite landed before
 * dedup was in place).
 */
export async function findPlacementRender(
  designId: string,
  productId: string,
  placementId: string,
  /** When set, only match a render anchored on this exact source image (#25).
   * Non-front placements pick from multiple sources, so the cache must key on
   * the pick — otherwise two back choices collide on one (design,product,back)
   * row. Front passes nothing → legacy behavior (one render per product). */
  sourceImageId?: string
): Promise<{ id: string; imageUrl: string; aspectRatio: AspectRatio } | null> {
  const rows = await db
    .select({
      id: placementRenderTable.id,
      imageUrl: placementRenderTable.imageUrl,
      aspectRatio: placementRenderTable.aspectRatio,
    })
    .from(placementRenderTable)
    .where(
      and(
        eq(placementRenderTable.designId, designId),
        eq(placementRenderTable.blankId, productId),
        eq(placementRenderTable.placementId, placementId),
        ...(sourceImageId
          ? [eq(placementRenderTable.sourceImageId, sourceImageId)]
          : [])
      )
    )
    .orderBy(desc(placementRenderTable.createdAt), RENDER_SEQ_DESC)
    .limit(1);
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    imageUrl: rows[0].imageUrl,
    aspectRatio: rows[0].aspectRatio as AspectRatio,
  };
}

export type ImageRef = {
  id: string;
  imageUrl: string;
  aspectRatio: AspectRatio;
};

/**
 * Resolve image ids to their URL + aspect across BOTH artifact tables.
 *
 * An id minted by a generation lives in `image`; one minted by a placement
 * render lives in `placement_render`. Orders, cart lines and organizer
 * products pin whichever they were shown, and id reuse (§2) means the id
 * alone doesn't say which — so every id lookup checks both. Missing ids are
 * simply absent from the map.
 */
export async function resolveImagesByIds(
  ids: string[]
): Promise<Map<string, ImageRef>> {
  const out = new Map<string, ImageRef>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;

  const artifacts = await db
    .select({
      id: imageTable.id,
      imageUrl: imageTable.imageUrl,
      aspectRatio: imageTable.aspectRatio,
    })
    .from(imageTable)
    .where(inArray(imageTable.id, unique));
  for (const r of artifacts) {
    out.set(r.id, { ...r, aspectRatio: r.aspectRatio as AspectRatio });
  }

  const missing = unique.filter((id) => !out.has(id));
  if (missing.length === 0) return out;

  const renders = await db
    .select({
      id: placementRenderTable.id,
      imageUrl: placementRenderTable.imageUrl,
      aspectRatio: placementRenderTable.aspectRatio,
    })
    .from(placementRenderTable)
    .where(inArray(placementRenderTable.id, missing));
  for (const r of renders) {
    out.set(r.id, { ...r, aspectRatio: r.aspectRatio as AspectRatio });
  }
  return out;
}

export type ImageRow = {
  id: string;
  /** The conversation that produced it. Null only for an artifact with no
   * output link and no source design (nothing writes that shape today). */
  designId: string | null;
  imageUrl: string;
  aspectRatio: AspectRatio;
  prompt: string | null;
  publishedAt: Date | null;
};

/**
 * Fetch a single image by id — artifact first, then the render cache (id
 * reuse, see resolveImagesByIds). Returns null if neither has it.
 */
export async function getDesignImageById(id: string): Promise<ImageRow | null> {
  const full = await getDesignImageWithOwner(id);
  if (!full) return null;
  return {
    id: full.id,
    designId: full.designId,
    imageUrl: full.imageUrl,
    aspectRatio: full.aspectRatio,
    prompt: full.prompt,
    publishedAt: full.publishedAt,
  };
}

/**
 * Fetch an image plus the fields the placement-source guard needs: publish /
 * moderation state (from `listing`) and the owner (#72). `image.ownerId` is
 * denormalized, so the artifact path no longer joins `design`; renders still
 * do, since only their conversation carries an owner.
 */
export async function getDesignImageWithOwner(
  id: string
): Promise<(ImageRow & { isHidden: boolean; ownerId: string }) | null> {
  const [artifact] = await db
    .select({
      id: imageTable.id,
      sourceDesignId: imageTable.sourceDesignId,
      linkDesignId: conversationImageTable.designId,
      imageUrl: imageTable.imageUrl,
      aspectRatio: imageTable.aspectRatio,
      prompt: imageTable.prompt,
      ownerId: imageTable.ownerId,
      publishedAt: listingTable.publishedAt,
      isHidden: listingTable.isHidden,
    })
    .from(imageTable)
    .leftJoin(
      conversationImageTable,
      and(
        eq(conversationImageTable.imageId, imageTable.id),
        eq(conversationImageTable.role, "output")
      )
    )
    .leftJoin(listingTable, eq(listingTable.imageId, imageTable.id))
    .where(eq(imageTable.id, id))
    .limit(1);

  if (artifact) {
    return {
      id: artifact.id,
      designId: artifact.sourceDesignId ?? artifact.linkDesignId,
      imageUrl: artifact.imageUrl,
      aspectRatio: artifact.aspectRatio as AspectRatio,
      prompt: artifact.prompt,
      // No listing row = not published. isHidden is listing-only state, so an
      // unpublished image reads as not hidden — same as the old columns.
      publishedAt: artifact.publishedAt,
      isHidden: artifact.isHidden ?? false,
      ownerId: artifact.ownerId,
    };
  }

  const [render] = await db
    .select({
      id: placementRenderTable.id,
      designId: placementRenderTable.designId,
      imageUrl: placementRenderTable.imageUrl,
      aspectRatio: placementRenderTable.aspectRatio,
      ownerId: designTable.userId,
    })
    .from(placementRenderTable)
    .innerJoin(designTable, eq(designTable.id, placementRenderTable.designId))
    .where(eq(placementRenderTable.id, id))
    .limit(1);
  if (!render) return null;

  // Renders are never published in their own right.
  return {
    id: render.id,
    designId: render.designId,
    imageUrl: render.imageUrl,
    aspectRatio: render.aspectRatio as AspectRatio,
    prompt: null,
    publishedAt: null,
    isHidden: false,
    ownerId: render.ownerId,
  };
}

/**
 * Find the image whose imageUrl matches a target URL, scoped to a design.
 * Used at order-creation time to pin the order to the specific image that was
 * on screen when the customer clicked checkout. Artifacts first, then the
 * render cache (a URL can come from either surface). Null if neither matches
 * (e.g. pre-Phase-2 designs that haven't been backfilled).
 *
 * Matches any conversation link role: a seed image (slice 3) shown in the
 * thread is pinnable/orderable exactly like an output.
 */
export async function findDesignImageByUrl(
  designId: string,
  imageUrl: string
): Promise<string | null> {
  const artifacts = await db
    .select({ id: imageTable.id })
    .from(conversationImageTable)
    .innerJoin(imageTable, eq(imageTable.id, conversationImageTable.imageId))
    .where(
      and(
        eq(conversationImageTable.designId, designId),
        eq(imageTable.imageUrl, imageUrl)
      )
    )
    .orderBy(desc(imageTable.createdAt), IMAGE_SEQ_DESC)
    .limit(1);
  if (artifacts[0]) return artifacts[0].id;

  const renders = await db
    .select({ id: placementRenderTable.id })
    .from(placementRenderTable)
    .where(
      and(
        eq(placementRenderTable.designId, designId),
        eq(placementRenderTable.imageUrl, imageUrl)
      )
    )
    .orderBy(desc(placementRenderTable.createdAt), RENDER_SEQ_DESC)
    .limit(1);
  return renders[0]?.id ?? null;
}

/**
 * Resolve the image URL to display for a list of orders. Prefers each
 * order's `placements.front` (a design_image id snapshot from purchase
 * time) over the design's current display image, so historical orders
 * keep showing what was actually printed even if the design was
 * regenerated afterward.
 *
 * Falls back to the provided fallback map (designId → display URL)
 * when the order has no placements or the referenced design_image is
 * gone.
 */
export async function resolveOrderImageUrls(
  orders: { id: string; designId: string; placements: Record<string, string> | null }[],
  fallback: Map<string, string | null>
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();

  const imageIds = orders
    .map((o) => o.placements?.front)
    .filter((v): v is string => Boolean(v));

  const byId = await resolveImagesByIds(imageIds);

  for (const o of orders) {
    const pinned = o.placements?.front
      ? byId.get(o.placements.front)?.imageUrl
      : undefined;
    out.set(o.id, pinned ?? fallback.get(o.designId) ?? null);
  }
  return out;
}

export type SourceImage = {
  id: string;
  imageUrl: string;
  aspectRatio: AspectRatio;
  prompt: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  /** See DesignImage.role — `seed` rows only appear with includeSeeds. */
  role: "output" | "seed";
};

/**
 * Fetch all source images for a design — the conversation's `output` links
 * (exploratory 1:1 generations and user uploads). Ordered oldest → newest so
 * the chat-thread gallery scrolls forward in time.
 *
 * `includeSeeds` also returns the thread's `seed` links (fresh-start images,
 * slice 3), role-tagged; a seed's image.created_at predates every output the
 * thread generates, so the shared ordering keeps it first. Default excludes
 * them so existing callers (the back-source "This design" group) keep their
 * outputs-only semantics.
 */
export async function getDesignSourceImages(
  designId: string,
  opts: { includeSeeds?: boolean } = {}
): Promise<SourceImage[]> {
  const rows = await db
    .select({
      id: imageTable.id,
      imageUrl: imageTable.imageUrl,
      aspectRatio: imageTable.aspectRatio,
      prompt: imageTable.prompt,
      createdAt: imageTable.createdAt,
      publishedAt: listingTable.publishedAt,
      role: conversationImageTable.role,
    })
    .from(conversationImageTable)
    .innerJoin(imageTable, eq(imageTable.id, conversationImageTable.imageId))
    .leftJoin(listingTable, eq(listingTable.imageId, imageTable.id))
    .where(
      and(
        eq(conversationImageTable.designId, designId),
        opts.includeSeeds
          ? inArray(conversationImageTable.role, ["output", "seed"])
          : eq(conversationImageTable.role, "output")
      )
    )
    .orderBy(asc(imageTable.createdAt), IMAGE_SEQ_ASC);

  return rows.map((r) => ({
    id: r.id,
    imageUrl: r.imageUrl,
    aspectRatio: r.aspectRatio as AspectRatio,
    prompt: r.prompt,
    createdAt: r.createdAt,
    publishedAt: r.publishedAt,
    role: r.role,
  }));
}

export type ProductVersion = {
  id: string;
  imageUrl: string;
  aspectRatio: AspectRatio;
  placementId: string;
  createdAt: Date;
};

export type ProductVersionGroup = {
  productId: string;
  productName: string;
  images: ProductVersion[];
};

/**
 * Fetch placement-targeted renders for a design, grouped by blank. Each
 * group's `images` is ordered oldest → newest. Blanks with no renders for
 * this design are omitted entirely.
 */
export async function getDesignPlacementRenders(
  designId: string
): Promise<ProductVersionGroup[]> {
  const rows = await db
    .select({
      id: placementRenderTable.id,
      imageUrl: placementRenderTable.imageUrl,
      aspectRatio: placementRenderTable.aspectRatio,
      blankId: placementRenderTable.blankId,
      placementId: placementRenderTable.placementId,
      createdAt: placementRenderTable.createdAt,
    })
    .from(placementRenderTable)
    .where(eq(placementRenderTable.designId, designId))
    .orderBy(asc(placementRenderTable.createdAt), RENDER_SEQ_ASC);

  const byProduct = new Map<string, ProductVersionGroup>();
  for (const r of rows) {
    let group = byProduct.get(r.blankId);
    if (!group) {
      const product = getBlank(r.blankId);
      group = {
        productId: r.blankId,
        productName: product?.name ?? r.blankId,
        images: [],
      };
      byProduct.set(r.blankId, group);
    }
    group.images.push({
      id: r.id,
      imageUrl: r.imageUrl,
      aspectRatio: r.aspectRatio as AspectRatio,
      placementId: r.placementId,
      createdAt: r.createdAt,
    });
  }
  return Array.from(byProduct.values());
}

/**
 * Resolve the display image URL for a design — the URL surfaced on
 * /designs cards, /orders rows, the design hydration on /design, etc.
 *
 * Resolution: design.primary_image_id → its image URL. Fallback: the
 * most recent source image (product_id IS NULL). Null when neither.
 *
 * Use this everywhere a design's "main image URL" is needed —
 * card thumbnails, hydration, mockup gen fallback.
 */
export async function getDesignDisplayImageUrl(
  designId: string
): Promise<string | null> {
  const map = await resolveDesignDisplayImageUrls([designId]);
  return map.get(designId) ?? null;
}

/**
 * Batch version of getDesignDisplayImageUrl — for list pages (/designs,
 * /orders, /admin) that would otherwise N+1 the design_image table.
 * One query for primary lookups, one for latest-source fallbacks.
 */
export async function resolveDesignDisplayImageUrls(
  designIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (designIds.length === 0) return out;

  const designRows = await db
    .select({
      id: designTable.id,
      primaryImageId: designTable.primaryImageId,
    })
    .from(designTable)
    .where(inArray(designTable.id, designIds));

  const primaryIds = designRows
    .map((d) => d.primaryImageId)
    .filter((v): v is string => Boolean(v));

  const urlByImageId = await resolveImagesByIds(primaryIds);

  // First pass: pick up everything with a working primary pointer.
  const needFallback: string[] = [];
  for (const d of designRows) {
    const url = d.primaryImageId
      ? urlByImageId.get(d.primaryImageId)?.imageUrl
      : undefined;
    if (url) {
      out.set(d.id, url);
    } else {
      needFallback.push(d.id);
    }
  }

  // Fallback: the design's latest output artifact.
  if (needFallback.length > 0) {
    const fallbackRows = await db
      .select({
        designId: conversationImageTable.designId,
        imageUrl: imageTable.imageUrl,
      })
      .from(conversationImageTable)
      .innerJoin(imageTable, eq(imageTable.id, conversationImageTable.imageId))
      .where(
        and(
          inArray(conversationImageTable.designId, needFallback),
          eq(conversationImageTable.role, "output")
        )
      )
      .orderBy(desc(imageTable.createdAt), IMAGE_SEQ_DESC);

    for (const r of fallbackRows) {
      if (!out.has(r.designId)) out.set(r.designId, r.imageUrl);
    }
  }

  return out;
}

/**
 * Delete an image from a design. Ref-counted (slice 4, plan §7): when the
 * image is still referenced elsewhere — a conversation link from another
 * design (seed), a shop product's placements, or a cart line's placements —
 * only this design's link (and the legacy design_image row) is removed; the
 * image row, its listing and the other references survive. Order references
 * are the caller's job to refuse BEFORE calling (they block, not detach).
 *
 * Returns the id that should become the design's new primary_image_id (the
 * most recent remaining source image), or null if there are no source images
 * left. Caller is responsible for updating design.primary_image_id.
 */
export async function deleteDesignImageRow(
  designId: string,
  imageId: string
): Promise<{ newPrimaryId: string | null }> {
  const [linkedElsewhere, productPins, cartPins] = await Promise.all([
    db
      .select({ id: conversationImageTable.id })
      .from(conversationImageTable)
      .where(
        and(
          eq(conversationImageTable.imageId, imageId),
          ne(conversationImageTable.designId, designId)
        )
      )
      .limit(1),
    // Image ids are UUIDs, so the JSON substring match can't false-positive.
    db
      .select({ id: productTable.id })
      .from(productTable)
      .where(sql`${productTable.placements} LIKE ${"%" + imageId + "%"}`)
      .limit(1),
    db
      .select({ id: cartItemTable.id })
      .from(cartItemTable)
      .where(sql`${cartItemTable.placements} LIKE ${"%" + imageId + "%"}`)
      .limit(1),
  ]);

  const decision = imageReferences({
    order: false, // refused by the caller before this runs
    otherConversation: linkedElsewhere.length > 0,
    product: productPins.length > 0,
    cart: cartPins.length > 0,
  });

  await db.batch([
    // Legacy design_image rows (pre-cutover) still FK design.id — keep
    // sweeping them until slice 5 drops the table. New rows never exist here.
    db
      .delete(designImageTable)
      .where(
        and(
          eq(designImageTable.id, imageId),
          eq(designImageTable.designId, designId)
        )
      ),
    db
      .delete(conversationImageTable)
      .where(
        and(
          eq(conversationImageTable.imageId, imageId),
          eq(conversationImageTable.designId, designId)
        )
      ),
    ...(decision === "detach"
      ? []
      : [
          db.delete(imageTable).where(eq(imageTable.id, imageId)),
          db.delete(listingTable).where(eq(listingTable.imageId, imageId)),
          db
            .delete(placementRenderTable)
            .where(eq(placementRenderTable.id, imageId)),
        ]),
  ]);

  const remaining = await db
    .select({ id: imageTable.id })
    .from(conversationImageTable)
    .innerJoin(imageTable, eq(imageTable.id, conversationImageTable.imageId))
    .where(
      and(
        eq(conversationImageTable.designId, designId),
        eq(conversationImageTable.role, "output")
      )
    )
    .orderBy(desc(imageTable.createdAt), IMAGE_SEQ_DESC)
    .limit(1);

  return { newPrimaryId: remaining[0]?.id ?? null };
}
