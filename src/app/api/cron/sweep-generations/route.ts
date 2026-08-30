import { NextRequest, NextResponse } from "next/server";
import { sweepOrphanedGenerations, defaultSweepGenerationsDeps } from "@/lib/sweep-generations";

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

  return NextResponse.json(result);
}
