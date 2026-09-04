import { NextRequest, NextResponse } from "next/server";
import { sweepOrphanedGenerations, defaultSweepGenerationsDeps } from "@/lib/sweep-generations";
import { sweepIdleConversations } from "@/lib/archive-conversations";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Cron backstop for the durable generation job. The lazy sweep in
// generation-job.ts reclaims a stale job's ROW on every design/thread read;
// this route is the only path that reclaims the R2 OBJECT stranded when a
// design nobody reopens loses its process mid-generation. See
// src/lib/sweep-generations.ts for the full rationale and the batch cap.
export async function GET(request: NextRequest) {
  // Vercel Cron injects `Authorization: Bearer ${CRON_SECRET}` on scheduled
  // calls. Require it so the endpoint isn't publicly triggerable; treat a
  // missing secret as misconfiguration rather than an open door.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("sweep-generations: CRON_SECRET not set");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sweepOrphanedGenerations(defaultSweepGenerationsDeps);

  // Studio auto-archive (studio-plan slice 4) rides this cron rather than
  // getting one of its own: `vercel.json` is at Vercel Hobby's two-cron
  // limit. The Studio's own load is the primary sweep — this is the backstop
  // for a user who stops opening it, which is exactly the user whose lanes
  // need archiving. Ordered after the generation sweep so a job it just
  // failed no longer holds its conversation open.
  //
  // Isolated: an archive failure must not turn a successful R2 reclaim into a
  // 500, and Vercel retries nothing here — the next daily run picks it up.
  let archivedConversations: number | null = null;
  try {
    const archive = await sweepIdleConversations({ scope: "all" });
    archivedConversations = archive.archived;
  } catch (err) {
    console.error("[sweep-generations] conversation archive sweep failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({ ...result, archivedConversations });
}
