"use server";

import { and, eq, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { auth, isAnonymousUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { design as designTable } from "@/lib/db/schema";
import {
  executeDesignDeletion,
  isDeletionBlocked,
  planDesignDeletion,
} from "@/lib/delete-design";
import { r2KeysForPlan } from "@/lib/delete-designs-since";
import { deleteObjectByKey, imageKeyFromUrl } from "@/lib/r2";
import { getStudioLanesData, type StudioLane } from "@/lib/studio";
import type { BulkDeleteResult } from "@/lib/studio-view";

/**
 * The poll target for /studio: re-reads the whole surface (lanes, cells,
 * pending cells) so a settle, a new generation from another tab, and a
 * lazily-swept stale job all land in one response. Same gate as the page —
 * the Studio is a personal-record surface, so anonymous guests are refused
 * like signed-out callers.
 */
export async function getStudioLanes(): Promise<StudioLane[]> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || isAnonymousUser(session.user)) {
    throw new Error("Unauthorized");
  }
  return getStudioLanesData(session.user.id);
}

/**
 * Bulk delete from the Studio's select mode (#189). Same rules as the single
 * Delete (src/lib/delete-design.ts), applied per conversation:
 *
 *  - ids that don't exist or belong to someone else are reported `not_found`
 *    (one answer for both, so the action can't be used to probe ownership);
 *  - a conversation referenced by an order or a shop product is skipped WHOLE
 *    — not archived like the single Delete does, not partially deleted — and
 *    reported `ordered` / `product`;
 *  - the rest are deleted one batch per conversation, never one batch across
 *    them: a failure mid-way leaves the earlier ones deleted and reports the
 *    failed one as `failed`, so the client can put its lane back.
 *
 * A lane with a running generation is disabled in the UI; the action itself
 * does not refuse it (executeDesignDeletion drops the job row and the
 * continuation dies on the FK — the same trade the single Delete makes).
 *
 * R2 objects of deleted images are removed after each DB batch, best-effort:
 * a failed object delete is logged and never fails the action, because the
 * rows are already gone and the daily sweep cannot find them either — an
 * orphaned object costs storage, a thrown action costs the user a lane that
 * is in fact deleted.
 */
export async function deleteConversations(
  designIds: string[]
): Promise<BulkDeleteResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || isAnonymousUser(session.user)) {
    throw new Error("Unauthorized");
  }
  const ids = [...new Set(designIds)];
  const result: BulkDeleteResult = { deleted: [], skipped: [] };
  if (ids.length === 0) return result;

  const owned = new Set(
    (
      await db
        .select({ id: designTable.id })
        .from(designTable)
        .where(
          and(
            inArray(designTable.id, ids),
            eq(designTable.userId, session.user.id)
          )
        )
    ).map((r) => r.id)
  );

  for (const id of ids) {
    if (!owned.has(id)) {
      result.skipped.push({ id, reason: "not_found" });
      continue;
    }
    const plan = await planDesignDeletion(db, id);
    if (isDeletionBlocked(plan)) {
      result.skipped.push({
        id,
        reason: plan.orderReferenced ? "ordered" : "product",
      });
      continue;
    }
    try {
      await executeDesignDeletion(db, plan);
    } catch (err) {
      console.error(
        `[studio] deleteConversations: ${id} failed: ${err instanceof Error ? err.message : String(err)}`
      );
      result.skipped.push({ id, reason: "failed" });
      continue;
    }
    result.deleted.push(id);

    const settled = await Promise.allSettled(
      r2KeysForPlan(plan, imageKeyFromUrl).map((key) => deleteObjectByKey(key))
    );
    for (const s of settled) {
      if (s.status === "rejected") {
        console.error(
          `[studio] deleteConversations: R2 delete failed for ${id}: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`
        );
      }
    }
  }

  return result;
}
