/**
 * Backfill: copy design.chat_history JSON arrays into chat_message rows.
 *
 * For each design's chat_history array:
 *   - Resolve msg.imageUrl → design_image.id (existing row matching the URL).
 *   - If no matching design_image row (legacy user upload that never wrote
 *     one), insert a new design_image row with product_id NULL and
 *     prompt='[user upload]', then link the message to that id.
 *   - Insert a chat_message row with role/content/image_id.
 *   - created_at = design.createdAt + (msg index * 1ms) so ordering is
 *     preserved without colliding.
 *
 * Idempotent: skips designs that already have at least one chat_message
 * row.
 *
 * Run dry first:
 *   tsx --env-file=.env.local scripts/migrate-chat-history-to-table.ts --dry-run
 * Then for real:
 *   tsx --env-file=.env.local scripts/migrate-chat-history-to-table.ts
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq, and } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import type { LegacyChatMessage } from "../src/lib/db/schema";

const DRY_RUN = process.argv.includes("--dry-run");

const db = drizzle(
  createClient({
    url: process.env.DATABASE_URL!,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  }),
  { schema }
);

async function findDesignImageIdByUrl(
  designId: string,
  url: string
): Promise<string | null> {
  const rows = await db
    .select({ id: schema.designImage.id })
    .from(schema.designImage)
    .where(
      and(
        eq(schema.designImage.designId, designId),
        eq(schema.designImage.imageUrl, url)
      )
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

async function main() {
  console.log(DRY_RUN ? "DRY RUN — no writes" : "LIVE RUN");

  const designs = await db.select().from(schema.design);
  console.log(`Designs total: ${designs.length}`);

  let designsAlreadyMigrated = 0;
  let designsSkippedNoHistory = 0;
  let designsMigrated = 0;
  let messagesInserted = 0;
  let uploadsBackfilled = 0;

  for (const d of designs) {
    const existing = await db
      .select({ id: schema.chatMessage.id })
      .from(schema.chatMessage)
      .where(eq(schema.chatMessage.designId, d.id))
      .limit(1);
    if (existing.length > 0) {
      designsAlreadyMigrated++;
      continue;
    }

    const history = (d.chatHistory as LegacyChatMessage[] | null) ?? [];
    if (history.length === 0) {
      designsSkippedNoHistory++;
      continue;
    }

    const baseMs = d.createdAt.getTime();

    for (let i = 0; i < history.length; i++) {
      const msg = history[i];

      let imageId: string | null = null;
      if (msg.imageUrl) {
        imageId = await findDesignImageIdByUrl(d.id, msg.imageUrl);

        // Legacy user upload that never wrote a design_image row —
        // insert one now so the gallery still shows it.
        if (!imageId && msg.role === "user") {
          imageId = crypto.randomUUID();
          if (!DRY_RUN) {
            await db.insert(schema.designImage).values({
              id: imageId,
              designId: d.id,
              parentImageId: null,
              aspectRatio: "1:1",
              productId: null,
              placementId: null,
              imageUrl: msg.imageUrl,
              prompt: "[user upload]",
              generationCost: 0,
              isApproved: false,
            });
          }
          uploadsBackfilled++;
        }
      }

      if (!DRY_RUN) {
        await db.insert(schema.chatMessage).values({
          id: crypto.randomUUID(),
          designId: d.id,
          role: msg.role,
          content: msg.content,
          imageId,
          createdAt: new Date(baseMs + i),
        });
      }
      messagesInserted++;
    }

    designsMigrated++;
  }

  console.log("---");
  console.log(`Designs already migrated (skipped): ${designsAlreadyMigrated}`);
  console.log(`Designs with no history (skipped): ${designsSkippedNoHistory}`);
  console.log(`Designs migrated: ${designsMigrated}`);
  console.log(`Chat messages inserted: ${messagesInserted}`);
  console.log(`Legacy user uploads backfilled into design_image: ${uploadsBackfilled}`);

  const totalMessages = await db
    .select({ id: schema.chatMessage.id })
    .from(schema.chatMessage);
  console.log("---");
  console.log(`chat_message rows in DB: ${totalMessages.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
