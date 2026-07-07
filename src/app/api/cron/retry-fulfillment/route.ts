import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createOrder } from "@/lib/printful";
import { generateOrderName } from "@/lib/ai";
import { retryStuckFulfillments } from "@/lib/retry-fulfillment";
import { getDesignDisplayImageUrl, getDesignImageById } from "@/lib/design-images";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Durability sweep (#39). Vercel Cron hits this daily; the core lives in
// retry-fulfillment.ts. See that file for the paid-but-unsubmitted rationale
// and guardrails.
export async function GET(request: NextRequest) {
  // Vercel Cron injects `Authorization: Bearer ${CRON_SECRET}` on scheduled
  // calls. Require it so the endpoint isn't publicly triggerable; treat a
  // missing secret as misconfiguration rather than an open door.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("retry-fulfillment: CRON_SECRET not set");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await retryStuckFulfillments({
    db,
    createPrintfulOrder: createOrder,
    generateOrderName,
    resolveDesignImageUrl: getDesignDisplayImageUrl,
    resolveImageUrlById: async (imageId) =>
      (await getDesignImageById(imageId))?.imageUrl ?? null,
  });

  return NextResponse.json(result);
}
