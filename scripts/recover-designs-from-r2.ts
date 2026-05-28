/**
 * Disaster-recovery script. Originally run 2026-05-27 after the
 * `design` and `design_image` tables were wiped (orders + R2 + users
 * survived). Rebuilds design + design_image rows for surviving orders
 * by listing R2 keys under designs/<designId>/<n>.png.
 *
 * Lossy: prompt, aspect ratio, chat history, and publish state cannot
 * be recovered. Each reconstructed image gets aspectRatio="1:1" and
 * prompt=null. Reconstructed designs are status="ordered".
 *
 * Idempotent: skips orders whose designId already has a design row, so
 * safe to re-run.
 *
 *   npx tsx --env-file .env.local scripts/recover-designs-from-r2.ts --dry-run
 *   npx tsx --env-file .env.local scripts/recover-designs-from-r2.ts
 */
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { db } from "../src/lib/db";
import {
  order as orderTable,
  design as designTable,
  designImage as designImageTable,
} from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

const DRY_RUN = process.argv.includes("--dry-run");

async function listGenerationPngs(
  r2: S3Client,
  bucket: string,
  designId: string
): Promise<number[]> {
  const res = await r2.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `designs/${designId}/`,
      MaxKeys: 1000,
    })
  );
  const generations: number[] = [];
  for (const obj of res.Contents ?? []) {
    const key = obj.Key ?? "";
    // designs/<id>/<n>.png — skip mockups/ and anything non-numeric
    const m = key.match(/^designs\/[^/]+\/(\d+)\.png$/);
    if (m) generations.push(parseInt(m[1], 10));
  }
  return generations.sort((a, b) => a - b);
}

async function main() {
  const r2 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  const bucket = process.env.R2_BUCKET_NAME!;
  const publicBase = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (!publicBase) throw new Error("NEXT_PUBLIC_R2_PUBLIC_URL not set");

  const orders = await db
    .select({
      designId: orderTable.designId,
      userId: orderTable.userId,
      createdAt: orderTable.createdAt,
    })
    .from(orderTable);

  const byDesign = new Map<string, { userId: string; createdAt: Date }>();
  for (const o of orders) {
    if (!byDesign.has(o.designId)) {
      byDesign.set(o.designId, { userId: o.userId, createdAt: o.createdAt });
    }
  }

  console.log(
    `${orders.length} orders covering ${byDesign.size} unique design ids`
  );

  let recovered = 0;
  let skipped = 0;
  let empty = 0;

  for (const [designId, meta] of byDesign) {
    const existing = await db.query.design.findFirst({
      where: eq(designTable.id, designId),
      columns: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    const gens = await listGenerationPngs(r2, bucket, designId);
    if (gens.length === 0) {
      console.log(`  ✗ design ${designId} — no PNGs in R2`);
      empty++;
      continue;
    }

    const primaryGen = gens[gens.length - 1];
    const imageRows = gens.map((n) => ({
      id: crypto.randomUUID(),
      designId,
      parentImageId: null as string | null,
      aspectRatio: "1:1",
      imageUrl: `${publicBase}/designs/${designId}/${n}.png`,
      prompt: null,
      generationCost: 0,
      isApproved: false,
      generation: n,
    }));
    const primaryImageId =
      imageRows.find((r) => r.generation === primaryGen)?.id ?? null;

    if (DRY_RUN) {
      console.log(
        `  [dry] design ${designId} → ${gens.length} images (primary=${primaryGen})`
      );
      recovered++;
      continue;
    }

    await db.insert(designTable).values({
      id: designId,
      userId: meta.userId,
      status: "ordered",
      primaryImageId,
      generationCount: gens.length,
      createdAt: meta.createdAt,
      updatedAt: meta.createdAt,
    });

    for (const row of imageRows) {
      await db.insert(designImageTable).values({
        id: row.id,
        designId: row.designId,
        parentImageId: row.parentImageId,
        aspectRatio: row.aspectRatio,
        imageUrl: row.imageUrl,
        prompt: row.prompt,
        generationCost: row.generationCost,
        isApproved: row.isApproved,
        createdAt: meta.createdAt,
      });
    }

    console.log(
      `  ✓ design ${designId} — ${gens.length} images (primary=${primaryGen})`
    );
    recovered++;
  }

  console.log(
    `\nDone. recovered=${recovered} skipped=${skipped} empty=${empty} ${DRY_RUN ? "[DRY RUN]" : ""}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
