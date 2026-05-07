import { db } from "@/lib/db";
import {
  design as designTable,
  designImage as designImageTable,
  chatMessage as chatMessageTable,
  type ChatMessage,
} from "@/lib/db/schema";
import { eq, and, asc, desc, inArray, isNull, isNotNull } from "drizzle-orm";
import { getProduct, type AspectRatio } from "@/lib/products";

export type DesignImage = {
  id: string;
  number: number;
  url: string;
  prompt: string;
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
 */
export async function getDesignImagesForAIContext(
  designId: string
): Promise<DesignImage[]> {
  const sources = await getDesignSourceImages(designId);
  return sources.map((s, i) => ({
    id: s.id,
    number: i + 1,
    url: s.imageUrl,
    prompt: s.prompt ?? "",
  }));
}

/**
 * Insert a new design_image row for a generation. Automatically links
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
}): Promise<string> {
  const latest = await db
    .select({ id: designImageTable.id })
    .from(designImageTable)
    .where(eq(designImageTable.designId, params.designId))
    .orderBy(desc(designImageTable.createdAt))
    .limit(1);

  const id = crypto.randomUUID();
  await db.insert(designImageTable).values({
    id,
    designId: params.designId,
    parentImageId: latest[0]?.id ?? null,
    aspectRatio: params.aspectRatio,
    productId: params.productId ?? null,
    placementId: params.placementId ?? null,
    imageUrl: params.imageUrl,
    prompt: params.prompt ?? null,
    generationCost: params.generationCost,
    isApproved: false,
  });
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
  placementId: string
): Promise<{ id: string; imageUrl: string; aspectRatio: AspectRatio } | null> {
  const rows = await db
    .select({
      id: designImageTable.id,
      imageUrl: designImageTable.imageUrl,
      aspectRatio: designImageTable.aspectRatio,
    })
    .from(designImageTable)
    .where(
      and(
        eq(designImageTable.designId, designId),
        eq(designImageTable.productId, productId),
        eq(designImageTable.placementId, placementId)
      )
    )
    .orderBy(desc(designImageTable.createdAt))
    .limit(1);
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    imageUrl: rows[0].imageUrl,
    aspectRatio: rows[0].aspectRatio as AspectRatio,
  };
}

/**
 * Fetch a single design_image by id. Returns null if not found.
 */
export async function getDesignImageById(
  id: string
): Promise<{
  id: string;
  designId: string;
  imageUrl: string;
  aspectRatio: AspectRatio;
  prompt: string | null;
} | null> {
  const rows = await db
    .select({
      id: designImageTable.id,
      designId: designImageTable.designId,
      imageUrl: designImageTable.imageUrl,
      aspectRatio: designImageTable.aspectRatio,
      prompt: designImageTable.prompt,
    })
    .from(designImageTable)
    .where(eq(designImageTable.id, id))
    .limit(1);
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    designId: rows[0].designId,
    imageUrl: rows[0].imageUrl,
    aspectRatio: rows[0].aspectRatio as AspectRatio,
    prompt: rows[0].prompt,
  };
}

/**
 * Find the design_image row whose imageUrl matches a target URL, scoped
 * to a design. Used at order-creation time to pin the order to the
 * specific image that was on screen when the customer clicked checkout.
 * Returns null if no matching row (e.g. pre-Phase-2 designs that haven't
 * been backfilled).
 */
export async function findDesignImageByUrl(
  designId: string,
  imageUrl: string
): Promise<string | null> {
  const rows = await db
    .select({ id: designImageTable.id })
    .from(designImageTable)
    .where(
      and(
        eq(designImageTable.designId, designId),
        eq(designImageTable.imageUrl, imageUrl)
      )
    )
    .orderBy(desc(designImageTable.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
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

  const imageRows =
    imageIds.length > 0
      ? await db
          .select({ id: designImageTable.id, imageUrl: designImageTable.imageUrl })
          .from(designImageTable)
          .where(inArray(designImageTable.id, imageIds))
      : [];
  const byId = new Map(imageRows.map((r) => [r.id, r.imageUrl]));

  for (const o of orders) {
    const pinned = o.placements?.front ? byId.get(o.placements.front) : undefined;
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
};

/**
 * Fetch all source images for a design (rows with product_id IS NULL —
 * the exploratory 1:1 generations and user uploads). Ordered oldest →
 * newest so the chat-thread gallery scrolls forward in time.
 */
export async function getDesignSourceImages(
  designId: string
): Promise<SourceImage[]> {
  const rows = await db
    .select({
      id: designImageTable.id,
      imageUrl: designImageTable.imageUrl,
      aspectRatio: designImageTable.aspectRatio,
      prompt: designImageTable.prompt,
      createdAt: designImageTable.createdAt,
    })
    .from(designImageTable)
    .where(
      and(
        eq(designImageTable.designId, designId),
        isNull(designImageTable.productId)
      )
    )
    .orderBy(asc(designImageTable.createdAt));

  return rows.map((r) => ({
    id: r.id,
    imageUrl: r.imageUrl,
    aspectRatio: r.aspectRatio as AspectRatio,
    prompt: r.prompt,
    createdAt: r.createdAt,
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
 * Fetch placement-targeted renders for a design (rows with non-null
 * product_id), grouped by product. Each group's `images` is ordered
 * oldest → newest. Products with no renders for this design are
 * omitted entirely.
 */
export async function getDesignPlacementRenders(
  designId: string
): Promise<ProductVersionGroup[]> {
  const rows = await db
    .select({
      id: designImageTable.id,
      imageUrl: designImageTable.imageUrl,
      aspectRatio: designImageTable.aspectRatio,
      productId: designImageTable.productId,
      placementId: designImageTable.placementId,
      createdAt: designImageTable.createdAt,
    })
    .from(designImageTable)
    .where(
      and(
        eq(designImageTable.designId, designId),
        isNotNull(designImageTable.productId)
      )
    )
    .orderBy(asc(designImageTable.createdAt));

  const byProduct = new Map<string, ProductVersionGroup>();
  for (const r of rows) {
    if (!r.productId) continue;
    let group = byProduct.get(r.productId);
    if (!group) {
      const product = getProduct(r.productId);
      group = {
        productId: r.productId,
        productName: product?.name ?? r.productId,
        images: [],
      };
      byProduct.set(r.productId, group);
    }
    group.images.push({
      id: r.id,
      imageUrl: r.imageUrl,
      aspectRatio: r.aspectRatio as AspectRatio,
      placementId: r.placementId ?? "default",
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

  const primaryRows =
    primaryIds.length > 0
      ? await db
          .select({
            id: designImageTable.id,
            imageUrl: designImageTable.imageUrl,
          })
          .from(designImageTable)
          .where(inArray(designImageTable.id, primaryIds))
      : [];
  const urlByImageId = new Map(primaryRows.map((r) => [r.id, r.imageUrl]));

  // First pass: pick up everything with a working primary pointer.
  const needFallback: string[] = [];
  for (const d of designRows) {
    const url = d.primaryImageId
      ? urlByImageId.get(d.primaryImageId)
      : undefined;
    if (url) {
      out.set(d.id, url);
    } else {
      needFallback.push(d.id);
    }
  }

  // Fallback: latest source image (product_id IS NULL) per design.
  if (needFallback.length > 0) {
    const fallbackRows = await db
      .select({
        designId: designImageTable.designId,
        imageUrl: designImageTable.imageUrl,
        createdAt: designImageTable.createdAt,
      })
      .from(designImageTable)
      .where(
        and(
          inArray(designImageTable.designId, needFallback),
          isNull(designImageTable.productId)
        )
      )
      .orderBy(desc(designImageTable.createdAt));

    for (const r of fallbackRows) {
      if (!out.has(r.designId)) out.set(r.designId, r.imageUrl);
    }
  }

  return out;
}

/**
 * Delete a design_image row. Returns the id that should become the
 * design's new primary_image_id (the most recent remaining source
 * image), or null if there are no source images left. Caller is
 * responsible for updating design.primary_image_id.
 */
export async function deleteDesignImageRow(
  designId: string,
  imageId: string
): Promise<{ newPrimaryId: string | null }> {
  await db
    .delete(designImageTable)
    .where(
      and(
        eq(designImageTable.id, imageId),
        eq(designImageTable.designId, designId)
      )
    );

  const remaining = await db
    .select({ id: designImageTable.id })
    .from(designImageTable)
    .where(
      and(
        eq(designImageTable.designId, designId),
        isNull(designImageTable.productId)
      )
    )
    .orderBy(desc(designImageTable.createdAt))
    .limit(1);

  return { newPrimaryId: remaining[0]?.id ?? null };
}
