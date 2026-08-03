/**
 * Restore alpha on legacy generations that lost it (#153).
 *
 * Until commit d131ed3 (2026-05-03) background removal used Bria, which
 * sometimes returned the un-removed RGB image; those PNGs print as a solid
 * box on colored garments. The current pipeline (BiRefNet) is fine — this is
 * a historical cleanup, not a live bug.
 *
 * Scans every design_image row, probes each PNG's header for an alpha channel
 * (IHDR colour type, plus a tRNS check for the types that can't carry a
 * per-pixel channel), and re-runs removeBackground on the opaque ones. The
 * result is verified to actually carry alpha, then written back under the
 * SAME R2 key — the stored URL never changes, and the Model B `image` table
 * shares ids+URLs with design_image, so fixing the object fixes both. Each
 * affected design's mockup_urls is nulled so stale cached mockups re-render.
 *
 * Idempotent: a re-run finds alpha present and does nothing.
 *
 * Dry-run by default:
 *   npx tsx --env-file=.env.local scripts/backfill-legacy-alpha.ts
 * Mutate:
 *   npx tsx --env-file=.env.local scripts/backfill-legacy-alpha.ts --apply
 */
import { config } from "dotenv";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../src/lib/db/schema";
import { pngHasAlpha, probeImageAlpha } from "../src/lib/image-alpha";

// Belt-and-braces .env.local load (works with or without --env-file). Runs
// before replicate.ts / r2.ts are touched — both construct clients reading
// env at module scope, so those imports are deferred into main().
config({ path: ".env.local" });

const PROBE_CONCURRENCY = 10;

type ImageRow = { id: string; designId: string; imageUrl: string };

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "APPLY — will overwrite R2 objects" : "DRY RUN — no writes");

  const db = drizzle(
    createClient({
      url: process.env.DATABASE_URL!,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    }),
    { schema }
  );

  const rows: ImageRow[] = await db
    .select({
      id: schema.designImage.id,
      designId: schema.designImage.designId,
      imageUrl: schema.designImage.imageUrl,
    })
    .from(schema.designImage);
  console.log(`scanning ${rows.length} design_image rows…`);

  const noAlpha: ImageRow[] = [];
  let unknown = 0;
  for (const batch of chunk(rows, PROBE_CONCURRENCY)) {
    await Promise.all(
      batch.map(async (row) => {
        const alpha = await probeImageAlpha(row.imageUrl);
        if (alpha === false) noAlpha.push(row);
        else if (alpha === null) {
          unknown++;
          console.warn(`  ? undeterminable (probe failed / not a PNG): ${row.imageUrl}`);
        }
      })
    );
  }

  console.log(`no-alpha images: ${noAlpha.length}`);
  for (const row of noAlpha) {
    console.log(`  ${row.id}  design=${row.designId}  ${row.imageUrl}`);
  }

  let fixed = 0;
  let failed = 0;
  const fixedDesignIds = new Set<string>();

  if (!apply) {
    if (noAlpha.length > 0) {
      console.log(`\nDry run — would re-run background removal on ${noAlpha.length} image(s), overwrite each at its existing R2 key, and null mockup_urls on ${new Set(noAlpha.map((r) => r.designId)).size} design(s). Re-run with --apply.`);
    }
  } else if (noAlpha.length > 0) {
    // Deferred: both read env/construct clients at module scope.
    const { removeBackground } = await import("../src/lib/replicate");
    const { overwriteImageObjectByUrl } = await import("../src/lib/r2");

    for (const row of noAlpha) {
      try {
        const outputUrl = await removeBackground(row.imageUrl);
        const res = await fetch(outputUrl);
        if (!res.ok) throw new Error(`fetch of knockout output failed: ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (pngHasAlpha(new Uint8Array(buf)) !== true) {
          console.error(`  ✗ STILL NO ALPHA after removeBackground — NOT overwriting ${row.id} (${row.imageUrl})`);
          failed++;
          continue;
        }
        await overwriteImageObjectByUrl(row.imageUrl, buf);
        fixedDesignIds.add(row.designId);
        fixed++;
        console.log(`  ✓ fixed ${row.id} (${buf.length} bytes)`);
      } catch (err) {
        console.error(`  ✗ failed ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
        failed++;
      }
    }

    // Stale cached mockups were rendered from the opaque artwork; nulling the
    // cache makes /preview re-render from the fixed object.
    if (fixedDesignIds.size > 0) {
      await db
        .update(schema.design)
        .set({ mockupUrls: null })
        .where(inArray(schema.design.id, [...fixedDesignIds]));
      console.log(`nulled mockup_urls on ${fixedDesignIds.size} design(s)`);
    }
  }

  console.log("---");
  console.log(`scanned:   ${rows.length}`);
  console.log(`no-alpha:  ${noAlpha.length}`);
  console.log(`unknown:   ${unknown}`);
  console.log(`fixed:     ${fixed}`);
  console.log(`failed:    ${failed}`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
