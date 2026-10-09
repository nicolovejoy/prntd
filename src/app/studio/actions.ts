"use server";

import { and, eq, inArray } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/lib/db";
import { design as designTable } from "@/lib/db/schema";
import {
  executeDesignDeletion,
  isDeletionBlocked,
  planDesignDeletion,
} from "@/lib/delete-design";
import { r2KeysForPlan } from "@/lib/delete-designs-since";
import { getDesignMessages } from "@/lib/design-images";
import { getGenerationJobStatusForUser } from "@/lib/generation-job";
import type { GenerationJobStatus } from "@/lib/lost-submit";
import { deleteObjectByKey, imageKeyFromUrl } from "@/lib/r2";
import { requireStudioActionSession } from "@/lib/require-user";
import {
  getStudioLanesData,
  sweepStudioForUser,
  type StudioLane,
} from "@/lib/studio";
import type { BulkDeleteResult } from "@/lib/studio-view";

/**
 * The poll target for /studio: re-reads the whole surface (lanes, cells,
 * pending cells) so a settle, a new generation from another tab, and a
 * lazily-swept stale job all land in one response. Same gate as the page
 * (canUseStudio, src/lib/require-user.ts): a signed-out caller is refused; an
 * anonymous guest is admitted while the guest funnel is on (#241) and gets
 * exactly their own lanes, since the read is scoped to the session's user id.
 *
 * The sweeps run via `after()` (#204), scheduled BEFORE the read so a
 * thrown read still lets them run — same shape as the page. This poll's own
 * response can be one sweep behind; the sweep it just scheduled shows up on
 * the NEXT poll, which is guaranteed to happen while any job is pending.
 */
export async function getStudioLanes(): Promise<StudioLane[]> {
  const session = await requireStudioActionSession();
  after(() => sweepStudioForUser(session.user.id));
  return getStudioLanesData(session.user.id);
}

/**
 * Owner-scoped job status lookup for the Studio's lost-submit reconcile
 * (#245): when a `generateDesign` response is lost after the server already
 * accepted the request, the client mints and sends its own job id, then asks
 * here whether that id ever became a real row. Same gate as `getStudioLanes`
 * (guests included while the guest funnel is on). Scoped to the session's own
 * user id by `getGenerationJobStatusForUser` — this says nothing about
 * another user's job id, or a malformed one; both read as `{status:"none"}`.
 */
export async function getGenerationJobStatus(
  jobId: string
): Promise<GenerationJobStatus> {
  const session = await requireStudioActionSession();
  return getGenerationJobStatusForUser(jobId, session.user.id);
}

/**
 * Bulk delete from the Studio's select mode (#189). Same rules as the single
 * Delete (src/lib/delete-design.ts), applied per conversation. Same gate as
 * the page, so a guest (guest funnel on, #241) can bulk-delete too — only
 * their own conversations, by the ownership check below:
 *
 *  - ids that don't exist or belong to someone else are reported `not_found`
 *    (one answer for both, so the action can't be used to probe ownership);
 *  - a conversation referenced by an order is skipped WHOLE — not archived
 *    like the single Delete does, not partially deleted — and reported
 *    `ordered`;
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
  const session = await requireStudioActionSession();
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
      result.skipped.push({ id, reason: "ordered" });
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

export type HistoryTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageId: string | null;
  createdAt: Date;
};

/**
 * The transcript behind the focused stage's "History" disclosure: every
 * chat_message of one conversation, oldest first. Owner-scoped (the design
 * row must belong to the session's user); same gate as getStudioLanes, so
 * guests read their own threads while the guest funnel is on. Read on
 * demand when the disclosure opens, never on the poll: a lane's transcript
 * is not bench state.
 */
export async function getConversationHistory(
  designId: string
): Promise<HistoryTurn[]> {
  const session = await requireStudioActionSession();
  const [owned] = await db
    .select({ id: designTable.id })
    .from(designTable)
    .where(
      and(eq(designTable.id, designId), eq(designTable.userId, session.user.id))
    )
    .limit(1);
  if (!owned) throw new Error("Unauthorized");
  const rows = await getDesignMessages(designId);
  return rows.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    imageId: m.imageId ?? null,
    createdAt: m.createdAt,
  }));
}
