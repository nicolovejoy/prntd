/**
 * Auto-archive (docs/studio-plan.md, slice 4): a conversation with no
 * activity for three days leaves the Studio.
 *
 * This is a new WRITER of an existing state, not a new state. `closed_at`
 * already means "read-only record" (#125), `assertConversationOpen` already
 * refuses chat/generate/upload on it, and `reopenConversation` already brings
 * it back. Nothing here is user-visible beyond the lane disappearing from
 * /studio and appearing on /studio/archive.
 *
 * Deliberately NOT a cron: `vercel.json` is at Vercel Hobby's two-cron limit.
 * It runs lazily on a read that happens anyway — the Studio's own load — with
 * the existing sweep-generations cron as the backstop, exactly the shape
 * `sweepStaleJobs` established in generation-job.ts.
 */
import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";
import type { db as appDb } from "./db";
import {
  design as designTable,
  chatMessage as chatMessageTable,
  conversationImage as conversationImageTable,
  image as imageTable,
  imageGeneration as imageGenerationTable,
} from "./db/schema";

// Type-only import so tests can inject an in-memory db without this module
// constructing the libSQL client at import time (generation-job.ts pattern).
type AppDb = typeof appDb;

/** No activity for this long and the conversation leaves the Studio. */
export const ARCHIVE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

/** Max conversations one sweep call will consider. */
export const ARCHIVE_SWEEP_LIMIT = 50;

export type ArchiveSweepResult = {
  /** Idle candidates examined this run, before the per-row conditional write. */
  scanned: number;
  /** Conversations this run actually transitioned to closed. */
  archived: number;
  /** Their ids, in the order they were archived. */
  designIds: string[];
};

async function resolveDb(db?: AppDb): Promise<AppDb> {
  return db ?? (await import("./db")).db;
}

/**
 * Close every conversation in scope that has been idle past ARCHIVE_AFTER_MS.
 *
 * The scope is a discriminated union rather than an optional userId, for the
 * same reason sweepStaleJobs uses one: with an optional field, a caller that
 * forgot to pass it type-checks as `{}` and silently sweeps every user's
 * conversations. `{ scope: "all" }` has to be said out loud, and only the
 * cron backstop says it.
 *
 * **Activity** is measured the way the Studio ranks lanes (`laneLastActiveAt`):
 * the freshest of the design row's `updated_at`, its newest image, its newest
 * chat turn, and any running job's start. Every writer that matters — chat
 * turn, generation completion, `setPrimaryImage` — does bump `updated_at`
 * today, so in practice `updated_at` is authoritative; the other three are
 * read anyway because this function ARCHIVES on the answer. A future writer
 * that forgets the bump should cost a lane its top slot, not close a
 * conversation somebody is using.
 *
 * `updated_at < cutoff` is therefore only a candidate prefilter, and it is
 * sound in the one direction that matters: a design whose `updated_at` is
 * recent is active and correctly skipped without further reads.
 *
 * A conversation with a running generation is never archived, whatever its
 * timestamps say. `status = 'running'` is the test, deliberately WITHOUT the
 * `cancelled_at is null` filter the Studio's pending-cell display uses:
 * cancel does not stop the render, so a cancelled-but-running job still lands
 * an image in the thread, and landing it in a conversation that was closed a
 * moment earlier is the outcome this exclusion exists to prevent. The stale
 * sweep (STALE_JOB_MS, 5 minutes) clears genuinely dead rows long before a
 * three-day threshold, so a permanently-running row cannot pin a lane open.
 *
 * `limit` bounds a run, oldest-idle first, so a backlog drains in order
 * across repeated calls rather than starving whichever rows sort last.
 *
 * The write is conditional (`… where id = ? and closed_at is null`), which is
 * what makes a second sweep a no-op and what makes racing a user's own manual
 * Close harmless: the loser transitions zero rows and does not count it.
 */
export async function sweepIdleConversations(
  params: ({ scope: "user"; userId: string } | { scope: "all" }) & {
    now?: Date;
    limit?: number;
    db?: AppDb;
  }
): Promise<ArchiveSweepResult> {
  const db = await resolveDb(params.db);
  const now = params.now ?? new Date();
  const cutoff = new Date(now.getTime() - ARCHIVE_AFTER_MS);
  const limit = params.limit ?? ARCHIVE_SWEEP_LIMIT;

  const candidates = await db
    .select({ id: designTable.id })
    .from(designTable)
    .where(
      and(
        isNull(designTable.closedAt),
        lt(designTable.updatedAt, cutoff),
        ...(params.scope === "user" ? [eq(designTable.userId, params.userId)] : [])
      )
    )
    .orderBy(asc(designTable.updatedAt))
    .limit(limit);

  if (candidates.length === 0) {
    return { scanned: 0, archived: 0, designIds: [] };
  }
  const ids = candidates.map((row) => row.id);

  // Three batched reads for the whole candidate set — never one per design.
  // Rows rather than max() aggregates: the timestamp columns don't share a
  // storage unit (design/image are seconds, chat_message is milliseconds), so
  // letting drizzle decode each column into a Date is the only comparison
  // that can't silently be off by 1000x. The candidate set is bounded by
  // `limit`, which keeps the row counts small.
  const [imageRows, chatRows, runningRows] = await Promise.all([
    db
      .select({
        designId: conversationImageTable.designId,
        createdAt: imageTable.createdAt,
      })
      .from(conversationImageTable)
      .innerJoin(imageTable, eq(imageTable.id, conversationImageTable.imageId))
      .where(inArray(conversationImageTable.designId, ids)),
    db
      .select({
        designId: chatMessageTable.designId,
        createdAt: chatMessageTable.createdAt,
      })
      .from(chatMessageTable)
      .where(inArray(chatMessageTable.designId, ids)),
    db
      .select({ designId: imageGenerationTable.designId })
      .from(imageGenerationTable)
      .where(
        and(
          inArray(imageGenerationTable.designId, ids),
          eq(imageGenerationTable.status, "running")
        )
      ),
  ]);

  const blocked = new Set(runningRows.map((row) => row.designId));
  for (const row of [...imageRows, ...chatRows]) {
    if (row.createdAt.getTime() >= cutoff.getTime()) blocked.add(row.designId);
  }

  const designIds: string[] = [];
  for (const id of ids) {
    if (blocked.has(id)) continue;
    // Conditional, so a conversation the user closed (or reopened and used)
    // between the select and here is left exactly as they left it. Note this
    // deliberately does not touch `updated_at`: archiving is the janitor, not
    // activity, and `laneLastActiveAt` should keep telling the truth about
    // when the lane last moved.
    const written = await db
      .update(designTable)
      .set({ closedAt: now })
      .where(and(eq(designTable.id, id), isNull(designTable.closedAt)))
      .returning({ id: designTable.id });
    if (written.length === 1) designIds.push(id);
  }

  return { scanned: ids.length, archived: designIds.length, designIds };
}
