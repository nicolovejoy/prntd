import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { guestFunnelEnabled } from "@/lib/flags";
import { getObjectByKey, imageKeyFromUrl } from "@/lib/r2";
import { canUseStudio } from "@/lib/require-user";
import {
  createDesignExportStream,
  exportArchiveName,
  exportPartCount,
  exportPartRows,
  loadExportRows,
  parseExportPart,
} from "@/lib/design-export";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * "Download all my designs": `GET /designs/export?part=N` streams one part
 * of the caller's images (oldest first, up to 50 images and 150 MB per
 * part, and 240 s of reading) as a zip with manifest.json (src/lib/design-export.ts). No `part`
 * means part 1. `part` only selects a slice of the caller's own rows.
 *
 * Who may call it: the /designs page gate's predicate (canUseStudio), a real
 * account, or a guest while GUEST_FUNNEL_ENABLED is on. The proxy matcher
 * covers `/designs` exactly, not this path, so this handler is the only gate.
 *
 * Answers:
 * - 200 the zip, `Content-Disposition` naming the part when there are several
 * - 400 `part` repeated, empty, or not a positive integer
 * - 401 no session (before any DB read)
 * - 403 a session the gate refuses (before any DB read)
 * - 404 `part` past the last part
 * Every refusal is plain text with `Cache-Control: no-store`; nothing
 * redirects.
 *
 * A route handler outside /api by owner decision (batch-3 answer 11): the
 * download link sits next to the page it exports from. The body streams, one
 * image read at a time and none before the client reads (so a HEAD, which
 * Next answers with GET, reads no object); there is no Content-Length.
 */
export async function GET(request: Request) {
  const refuse = (body: string, status: number) =>
    new Response(body, { status, headers: { "Cache-Control": "no-store" } });

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return refuse("Sign in to download your designs.", 401);
  if (!canUseStudio(session.user, guestFunnelEnabled())) {
    return refuse("Not available.", 403);
  }

  const rows = await loadExportRows(db, session.user.id);
  const partCount = exportPartCount(rows.length);
  const parsed = parseExportPart(new URL(request.url).searchParams, partCount);
  if (!parsed.ok) {
    return parsed.status === 400
      ? refuse("Invalid part number.", 400)
      : refuse("No such part.", 404);
  }

  const now = new Date();
  // The stream's time limit counts from construction, so build it last.
  const body = createDesignExportStream({
    rows: exportPartRows(rows, parsed.part),
    readObject: getObjectByKey,
    keyFromUrl: imageKeyFromUrl,
    now,
    part: parsed.part,
    partCount,
  });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${exportArchiveName(now, parsed.part, partCount)}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
