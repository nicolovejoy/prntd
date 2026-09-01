/**
 * Studio read model (docs/studio-plan.md, slice 2). One lane per open
 * conversation; cells are the conversation's images in creation order; a
 * running `image_generation` row is a pending cell.
 *
 * Assembled in a fixed number of statements regardless of lane count — the
 * client re-reads this whole surface on a poll while a generation is in
 * flight, so the path must stay flat: one design select, then three
 * batched reads (images, running jobs, first chat turns), never a query
 * per lane.
 *
 * Server-only (imports drizzle + schema). Client components import types
 * only; display helpers live in `studio-view.ts`.
 */
import { and, asc, eq, inArray, isNull, ne, sql, desc } from "drizzle-orm";
import type { db as appDb } from "./db";
import {
  design as designTable,
  chatMessage as chatMessageTable,
  conversationImage as conversationImageTable,
  image as imageTable,
  imageGeneration as imageGenerationTable,
} from "./db/schema";
import { sweepStaleJobs } from "./generation-job";

// Type-only import so tests can inject an in-memory db without this module
// constructing the libSQL client at import time (generation-job.ts pattern).
type AppDb = typeof appDb;

/** One image in a lane. */
export type StudioCell = {
  imageId: string;
  imageUrl: string;
  /** The conversation's primary_image_id — the marked cell. */
  isPrimary: boolean;
  createdAt: Date;
};

/** One running generation in a lane, rendered with elapsed time. */
export type StudioPendingCell = {
  jobId: string;
  generationNumber: number;
  startedAt: Date;
};

export type StudioLane = {
  designId: string;
  /** First user chat turn, falling back to the first image's prompt. */
  title: string | null;
  /** What "most recently active" is judged on — see laneLastActiveAt. */
  lastActiveAt: Date;
  cells: StudioCell[];
  pending: StudioPendingCell[];
};

/**
 * When the lane last moved: the freshest of the design row's own updatedAt,
 * the newest image, and any running job's start. Computed here rather than
 * trusting updatedAt alone because not every writer bumps it — starting a
 * job doesn't touch the design row until the completion batch lands, and a
 * lane with work in flight belongs at the top now, not when it finishes.
 */
export function laneLastActiveAt(input: {
  updatedAt: Date;
  cells: { createdAt: Date }[];
  pending: { startedAt: Date }[];
}): Date {
  let ms = input.updatedAt.getTime();
  for (const cell of input.cells) ms = Math.max(ms, cell.createdAt.getTime());
  for (const job of input.pending) ms = Math.max(ms, job.startedAt.getTime());
  return new Date(ms);
}

/**
 * The /studio lanes for one user. Query core shared by the server component
 * render and the polled server action — auth lives at the caller.
 */
export async function getStudioLanesData(
  userId: string,
  opts: { db?: AppDb } = {}
): Promise<StudioLane[]> {
  const db = opts.db ?? (await import("./db")).db;

  // An overdue running job would otherwise render as a pending cell forever.
  // Same lazy-sweep-on-read the thread and /designs loads do; narrowest scope
  // for this call site — only the cron sweeps scope: "all".
  await sweepStaleJobs({ scope: "user", userId, db });

  // Open = closed_at null (the plan's definition). Archived-status designs are
  // additionally excluded: archive is "make this go away" (deleteDesign's
  // order-referenced fallback), and /designs hides them for the same reason.
  const designs = await db
    .select({
      id: designTable.id,
      primaryImageId: designTable.primaryImageId,
      updatedAt: designTable.updatedAt,
    })
    .from(designTable)
    .where(
      and(
        eq(designTable.userId, userId),
        isNull(designTable.closedAt),
        ne(designTable.status, "archived")
      )
    )
    .orderBy(desc(designTable.updatedAt));

  if (designs.length === 0) return [];
  const designIds = designs.map((d) => d.id);

  const [imageRows, jobRows, firstTurnRows] = await Promise.all([
    // Both roles: a seed is one of the conversation's images, and its
    // image.created_at predates every output the thread generates, so the
    // shared ordering keeps it first (getDesignSourceImages convention,
    // rowid tiebreak included — created_at is seconds-resolution).
    db
      .select({
        designId: conversationImageTable.designId,
        imageId: imageTable.id,
        imageUrl: imageTable.imageUrl,
        prompt: imageTable.prompt,
        createdAt: imageTable.createdAt,
      })
      .from(conversationImageTable)
      .innerJoin(imageTable, eq(imageTable.id, conversationImageTable.imageId))
      .where(inArray(conversationImageTable.designId, designIds))
      .orderBy(asc(imageTable.createdAt), sql`image.rowid asc`),
    // One user-scoped read (the user_status index), not one per lane.
    // `cancelled_at is null` because this is DISPLAY accounting: cancel does
    // not stop the render, but the user already said they stopped watching —
    // see countActiveGenerationsForUser.
    db
      .select({
        designId: imageGenerationTable.designId,
        jobId: imageGenerationTable.id,
        generationNumber: imageGenerationTable.generationNumber,
        startedAt: imageGenerationTable.startedAt,
      })
      .from(imageGenerationTable)
      .where(
        and(
          eq(imageGenerationTable.userId, userId),
          eq(imageGenerationTable.status, "running"),
          isNull(imageGenerationTable.cancelledAt)
        )
      )
      .orderBy(asc(imageGenerationTable.generationNumber)),
    // First user turn per conversation — the lane label. Bare `content`
    // alongside min() relies on SQLite's documented min/max-aggregate
    // behavior (the bare column comes from the row achieving the min);
    // Turso is libSQL, so this holds in prod and in the test harness alike.
    db
      .select({
        designId: chatMessageTable.designId,
        content: chatMessageTable.content,
        firstAt: sql<number>`min(${chatMessageTable.createdAt})`,
      })
      .from(chatMessageTable)
      .where(
        and(
          inArray(chatMessageTable.designId, designIds),
          eq(chatMessageTable.role, "user")
        )
      )
      .groupBy(chatMessageTable.designId),
  ]);

  const cellsByDesign = new Map<
    string,
    { cell: StudioCell; prompt: string | null }[]
  >();
  for (const row of imageRows) {
    const list = cellsByDesign.get(row.designId) ?? [];
    list.push({
      cell: {
        imageId: row.imageId,
        imageUrl: row.imageUrl,
        isPrimary: false, // filled in per-design below
        createdAt: row.createdAt,
      },
      prompt: row.prompt,
    });
    cellsByDesign.set(row.designId, list);
  }

  const pendingByDesign = new Map<string, StudioPendingCell[]>();
  for (const row of jobRows) {
    const list = pendingByDesign.get(row.designId) ?? [];
    list.push({
      jobId: row.jobId,
      generationNumber: row.generationNumber,
      startedAt: row.startedAt,
    });
    pendingByDesign.set(row.designId, list);
  }

  const titleByDesign = new Map(
    firstTurnRows.map((row) => [row.designId, row.content])
  );

  const lanes = designs.map((design) => {
    const entries = cellsByDesign.get(design.id) ?? [];
    const cells = entries.map(({ cell }) => ({
      ...cell,
      isPrimary: cell.imageId === design.primaryImageId,
    }));
    const pending = pendingByDesign.get(design.id) ?? [];
    const chatTitle = titleByDesign.get(design.id)?.trim();
    const promptTitle = entries
      .find(({ prompt }) => prompt && prompt.trim().length > 0)
      ?.prompt?.trim();
    return {
      designId: design.id,
      title: chatTitle || promptTitle || null,
      lastActiveAt: laneLastActiveAt({
        updatedAt: design.updatedAt,
        cells,
        pending,
      }),
      cells,
      pending,
    };
  });

  // Stable sort over the updatedAt-desc base order, so equal activity
  // stamps keep a deterministic order.
  lanes.sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());
  return lanes;
}
