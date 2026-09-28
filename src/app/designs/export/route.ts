import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { guestFunnelEnabled } from "@/lib/flags";
import { getObjectByKey, imageKeyFromUrl } from "@/lib/r2";
import { canUseStudio } from "@/lib/require-user";
import {
  MAX_EXPORT_IMAGES,
  createDesignExportStream,
  exportArchiveName,
  loadExportRows,
} from "@/lib/design-export";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * "Download all my designs": streams a zip of every image the caller owns,
 * plus manifest.json (src/lib/design-export.ts).
 *
 * Who may call it: the /designs page gate's predicate (canUseStudio), a real
 * account, or a guest while GUEST_FUNNEL_ENABLED is on. The proxy matcher
 * covers `/designs` exactly, not this path, so this handler is the only gate.
 * It answers 401/403 as plain text and never redirects.
 *
 * A route handler outside /api by owner decision (batch-3 answer 11): the
 * download link sits next to the page it exports from. The body streams, one
 * image read at a time, so there is no Content-Length.
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
  if (rows.length > MAX_EXPORT_IMAGES) {
    return refuse("Too many designs to download in one file.", 413);
  }

  const now = new Date();
  const body = createDesignExportStream({
    rows,
    readObject: getObjectByKey,
    keyFromUrl: imageKeyFromUrl,
    now,
  });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${exportArchiveName(now)}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
