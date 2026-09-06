/**
 * Bulk-delete a user's conversations created inside a time window (#189) —
 * the logic behind scripts/delete-designs-since.ts, kept here so it can be
 * tested against the real-DB harness without shelling out.
 *
 * Per conversation this applies the same rules the Delete button does
 * (src/lib/delete-design.ts): an order reference skips the whole conversation
 * — never a partial delete; seed links, composition pins and cart pins detach
 * their image instead of deleting it; everything else goes. On `apply`, R2 objects for deleted image rows and the conversation's
 * placement renders are removed after the DB batch, best-effort (a failed
 * object delete is logged, never re-raised — the DB rows are already gone).
 */
import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import type { DbTarget } from "@/lib/db-target";
import {
  chatMessage as chatMessageTable,
  design as designTable,
  image as imageTable,
  user as userTable,
} from "@/lib/db/schema";
import {
  executeDesignDeletion,
  isDeletionBlocked,
  planDesignDeletion,
  type DesignDeletionPlan,
} from "@/lib/delete-design";

type Db = typeof appDb;

/**
 * Whether `--apply` may proceed against the classified DB target. Only dev
 * and an in-memory/file DB pass with no flag; prod needs `--confirm-prod`,
 * preview `--confirm-preview`. `unknown` (an `https://` or `wss://` Turso
 * URL, which classifyDbTarget can't place) refuses outright — a dashboard
 * URL must not be a way around the prod confirmation.
 */
export function applyGuard(
  target: DbTarget,
  flags: { confirmProd: boolean; confirmPreview: boolean }
): { ok: true } | { ok: false; reason: string } {
  switch (target) {
    case "dev":
    case "memory":
      return { ok: true };
    case "prod":
      return flags.confirmProd
        ? { ok: true }
        : {
            ok: false,
            reason:
              "Refusing --apply against prod without --confirm-prod. Re-run the dry run, read it, then add --confirm-prod.",
          };
    case "preview":
      return flags.confirmPreview
        ? { ok: true }
        : {
            ok: false,
            reason:
              "Refusing --apply against preview without --confirm-preview.",
          };
    case "unknown":
      return {
        ok: false,
        reason:
          "Refusing --apply: DATABASE_URL could not be classified as dev/preview/prod. Use the libsql:// form of the Turso URL (not https:// or wss://) so the target is recognised.",
      };
  }
}

/**
 * Parse a `--since` / `--until` value. Only an ISO-8601 string with an
 * explicit zone is accepted — `Z` or a `±HH:MM` offset. A naive
 * `2026-09-04T00:00:00` parses as LOCAL time in JS (07:00Z on a Pacific
 * laptop) while a bare `2026-09-04` parses as UTC, so a window typed without
 * a zone silently lands hours away from what was meant. Returns null when
 * rejected.
 */
export function parseWindowTimestamp(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(trimmed)) {
    return null;
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const WINDOW_TIMESTAMP_FORM =
  "an ISO-8601 timestamp with an explicit zone, e.g. 2026-09-04T00:00:00Z or 2026-09-03T17:00:00-07:00";

export interface DeleteDesignsSinceOptions {
  email: string;
  /** Inclusive lower bound on design.created_at. */
  since: Date;
  /** Inclusive upper bound on design.created_at; defaults to "now". */
  until?: Date;
  /** False = dry run: plan and report, write nothing. */
  apply: boolean;
  /** Deletes one R2 object by key. Only called on `apply`. */
  deleteObject: (key: string) => Promise<void>;
  /** Derives an R2 key from a public image URL (r2.ts `imageKeyFromUrl`).
   * Used when the image row carries no `r2_key` (legacy rows). */
  keyFromUrl: (imageUrl: string) => string | null;
  log?: (line: string) => void;
}

export interface ConversationReport {
  designId: string;
  createdAt: Date;
  label: string | null;
  plan: DesignDeletionPlan;
  /** What happened (apply) or would happen (dry run). */
  action: "delete" | "skip";
  skipReason?: "order";
}

export interface DeleteDesignsSinceResult {
  userId: string;
  matched: number;
  deleted: string[];
  skipped: { designId: string; reason: "order" }[];
  r2Deleted: number;
  r2Failed: number;
  reports: ConversationReport[];
}

/**
 * Something to recognise the conversation by in the report: its first user
 * message, else the prompt of its first image, else nothing. Truncated so a
 * pasted paragraph doesn't take the whole line.
 */
async function conversationLabel(
  db: Db,
  designId: string,
  plan: DesignDeletionPlan
): Promise<string | null> {
  const [firstUserMessage] = await db
    .select({ content: chatMessageTable.content })
    .from(chatMessageTable)
    .where(
      and(
        eq(chatMessageTable.designId, designId),
        eq(chatMessageTable.role, "user")
      )
    )
    .orderBy(asc(chatMessageTable.createdAt))
    .limit(1);
  let text: string | null = firstUserMessage?.content ?? null;
  if (!text && plan.images.length > 0) {
    const [firstImage] = await db
      .select({ prompt: imageTable.prompt })
      .from(imageTable)
      .where(eq(imageTable.id, plan.images[0].imageId))
      .limit(1);
    text = firstImage?.prompt ?? null;
  }
  return text ? truncate(text.replace(/\s+/g, " ").trim(), 60) : null;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** R2 keys the apply step should remove for a plan that just executed. */
export function r2KeysForPlan(
  plan: DesignDeletionPlan,
  keyFromUrl: (imageUrl: string) => string | null
): string[] {
  const keys: string[] = [];
  const removable = new Set(plan.removableImageIds);
  for (const img of plan.images) {
    if (!removable.has(img.imageId)) continue;
    const key = img.r2Key ?? (img.imageUrl ? keyFromUrl(img.imageUrl) : null);
    if (key) keys.push(key);
  }
  for (const render of plan.placementRenders) {
    const key = keyFromUrl(render.imageUrl);
    if (key) keys.push(key);
  }
  return [...new Set(keys)];
}

/** One report line per conversation, plus one indented line per image. */
export function formatReport(
  report: ConversationReport,
  mode: "dry-run" | "apply"
): string[] {
  const { designId, createdAt, label, plan, action } = report;
  const verb =
    action === "delete"
      ? mode === "apply"
        ? "DELETED"
        : "would delete"
      : "SKIPPED (referenced by an order)";
  const head = [
    designId.slice(0, 8),
    createdAt.toISOString(),
    `${plan.images.length} image${plan.images.length === 1 ? "" : "s"}`,
    verb,
    label ? `"${label}"` : "(no prompt)",
  ].join("  ");
  const lines = [head];
  for (const img of plan.images) {
    const outcome =
      img.outcome === "blocked-by-order" ? "BLOCKED-by-order" : img.outcome;
    // Under a skipped conversation nothing happens to any image; say so, and
    // keep the per-image decision visible so the blocker can still be found.
    const shown =
      action === "skip" && img.outcome !== "blocked-by-order"
        ? `kept (would be: ${outcome})`
        : outcome;
    lines.push(`    ${img.imageId.slice(0, 8)}  ${shown}`);
  }
  if (plan.placementRenders.length > 0) {
    const n = plan.placementRenders.length;
    lines.push(
      `    ${n} placement render${n === 1 ? "" : "s"}  ${action === "skip" ? "kept" : "delete"}`
    );
  }
  return lines;
}

export async function deleteDesignsSince(
  db: Db,
  opts: DeleteDesignsSinceOptions
): Promise<DeleteDesignsSinceResult> {
  const log = opts.log ?? (() => {});
  const until = opts.until ?? new Date();
  if (until < opts.since) {
    throw new Error("--until must not be earlier than --since");
  }

  // Better-Auth lowercases emails at sign-up; match the stored form.
  const email = opts.email.trim().toLowerCase();
  const [owner] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email))
    .limit(1);
  if (!owner) throw new Error(`No user with email ${email}`);

  const designs = await db
    .select({ id: designTable.id, createdAt: designTable.createdAt })
    .from(designTable)
    .where(
      and(
        eq(designTable.userId, owner.id),
        gte(designTable.createdAt, opts.since),
        lte(designTable.createdAt, until)
      )
    )
    .orderBy(asc(designTable.createdAt));

  const mode = opts.apply ? "apply" : "dry-run";
  const result: DeleteDesignsSinceResult = {
    userId: owner.id,
    matched: designs.length,
    deleted: [],
    skipped: [],
    r2Deleted: 0,
    r2Failed: 0,
    reports: [],
  };

  for (const d of designs) {
    const plan = await planDesignDeletion(db, d.id);
    const label = await conversationLabel(db, d.id, plan);
    const blocked = isDeletionBlocked(plan);
    const report: ConversationReport = {
      designId: d.id,
      createdAt: d.createdAt,
      label,
      plan,
      action: blocked ? "skip" : "delete",
      ...(blocked ? { skipReason: "order" as const } : {}),
    };
    result.reports.push(report);
    for (const line of formatReport(report, mode)) log(line);

    if (blocked) {
      result.skipped.push({ designId: d.id, reason: report.skipReason! });
      continue;
    }
    if (!opts.apply) continue;

    await executeDesignDeletion(db, plan);
    result.deleted.push(d.id);

    for (const key of r2KeysForPlan(plan, opts.keyFromUrl)) {
      try {
        await opts.deleteObject(key);
        result.r2Deleted += 1;
      } catch (err) {
        result.r2Failed += 1;
        log(
          `    R2 delete failed for ${key}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  return result;
}
