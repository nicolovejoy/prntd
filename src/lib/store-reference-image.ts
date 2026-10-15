import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { design as designTable } from "@/lib/db/schema";
import { insertChatMessage, insertDesignImage } from "@/lib/design-images";
import { meanLuminance } from "@/lib/image-luminance";
import { uploadImageObject } from "@/lib/r2";
import { normalizeReferenceImage } from "@/lib/reference-image";

/** Longest file name kept: it goes into the prompt, the chat turn and the lane title. */
export const REFERENCE_IMAGE_NAME_MAX_CHARS = 120;

export type StoreReferenceImageResult =
  | { ok: true; imageId: string; imageUrl: string; luminance: number | null }
  | { ok: false; reason: "too_large" | "unsupported" | "closed" };

/**
 * Stores one user-supplied reference image as an `upload` result of
 * `designId`, creating the conversation for an unseen id. The one body behind
 * `uploadReferenceImage` (/design) and `attachReferenceImage` (Studio); both
 * spend the upload quota before calling it.
 *
 * Order: normalize the bytes (size, decodable, format, rotation, resize, PNG)
 * FIRST, so a refused file touches nothing; then find or create the design
 * (another user's id throws Unauthorized; a closed one is refused); then the
 * R2 object; then the rows. If a step after the design insert fails, a design
 * this call created is removed again (best-effort), so a failed attach does
 * not leave an empty lane. Unexpected failures throw.
 */
export async function storeReferenceImage(opts: {
  designId: string;
  userId: string;
  base64Data: string;
  fileName: string;
}): Promise<StoreReferenceImageResult> {
  const { designId, userId } = opts;
  const fileName = opts.fileName.slice(0, REFERENCE_IMAGE_NAME_MAX_CHARS);

  const normalized = await normalizeReferenceImage(Buffer.from(opts.base64Data, "base64"));
  if (!normalized.ok) return { ok: false, reason: normalized.reason };
  const buffer = normalized.png;

  const [existing] = await db
    .select({ userId: designTable.userId, closedAt: designTable.closedAt })
    .from(designTable)
    .where(eq(designTable.id, designId))
    .limit(1);
  if (existing && existing.userId !== userId) throw new Error("Unauthorized");
  // Closed conversation = read-only thread: no uploads.
  if (existing && existing.closedAt !== null) return { ok: false, reason: "closed" };

  // Two concurrent calls on one unseen id can both insert; the loser throws
  // and the caller reports a failure to retry (nothing is at stake).
  let created = false;
  if (!existing) {
    await db.insert(designTable).values({ id: designId, userId });
    created = true;
  }

  try {
    const imageId = crypto.randomUUID();
    const luminance = await meanLuminance(buffer);
    if (luminance === null) {
      console.warn("[luminance] not computed for an upload", { imageId });
    }
    const imageUrl = await uploadImageObject(imageId, buffer);

    await insertDesignImage({
      id: imageId,
      designId,
      imageUrl,
      aspectRatio: "1:1",
      prompt: `[user upload] ${fileName}`,
      operation: "upload",
      generationCost: 0,
      luminance,
    });
    await insertChatMessage({
      designId,
      role: "user",
      content: `Uploaded reference image: ${fileName}`,
      imageId,
    });
    await db
      .update(designTable)
      .set({ updatedAt: new Date() })
      .where(eq(designTable.id, designId));

    return { ok: true, imageId, imageUrl, luminance };
  } catch (err) {
    if (created) {
      await db
        .delete(designTable)
        .where(eq(designTable.id, designId))
        .catch((e) =>
          console.error("[attach] could not remove the empty design", {
            designId,
            error: e instanceof Error ? e.message : String(e),
          })
        );
    }
    throw err;
  }
}
