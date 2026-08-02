import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// GET /api/health — unauthenticated, no side effects. ?db=1 verifies Turso is reachable.
// Ecosystem convention: docs/health-convention.md in prompt-lab.
export async function GET(request: NextRequest) {
  const deep = request.nextUrl.searchParams.get("db") === "1";

  if (!deep) {
    return NextResponse.json({ ok: true });
  }

  try {
    await db.run(sql`select 1`);
    return NextResponse.json({ ok: true, db: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, db: false, error: err instanceof Error ? err.message : String(err) },
      { status: 503 }
    );
  }
}
