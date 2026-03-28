/**
 * One-off script: remove backgrounds from all existing design images.
 *
 * Usage: npx tsx scripts/fix-backgrounds.ts
 *
 * Requires .env.local with REPLICATE_API_TOKEN, R2_*, DATABASE_URL, DATABASE_AUTH_TOKEN
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import Replicate from "replicate";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN! });

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const db = drizzle(
  createClient({
    url: process.env.DATABASE_URL!,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  }),
  { schema }
);

async function removeBackground(imageUrl: string): Promise<string> {
  const output = await replicate.run(
    "bria/remove-background:5ecc270b34e9d8e1f007d9dbd3c724f0badf638f05ffaa0c5e0634ed64d3d378",
    { input: { image: imageUrl } }
  );
  return String(output);
}

async function main() {
  const designs = await db.query.design.findMany({
    columns: { id: true, currentImageUrl: true, generationCount: true },
  });

  const withImages = designs.filter((d) => d.currentImageUrl);
  console.log(`Found ${withImages.length} designs with images`);

  for (const design of withImages) {
    const url = design.currentImageUrl!;
    console.log(`\nProcessing ${design.id} (gen ${design.generationCount})...`);
    console.log(`  Original: ${url}`);

    try {
      // Remove background
      const transparentUrl = await removeBackground(url);
      console.log(`  Transparent: ${transparentUrl}`);

      // Download the transparent image
      const res = await fetch(transparentUrl);
      const buffer = Buffer.from(await res.arrayBuffer());

      // Upload to R2, overwriting the current image
      const key = `designs/${design.id}/${design.generationCount}.png`;
      await r2.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME!,
          Key: key,
          Body: buffer,
          ContentType: "image/png",
        })
      );
      console.log(`  Uploaded: ${key}`);

      // Also fix images in chat history
      const full = await db.query.design.findFirst({
        where: eq(schema.design.id, design.id),
      });
      if (full?.chatHistory) {
        let updated = false;
        const history = full.chatHistory.map((msg) => {
          if (msg.imageUrl && msg.imageUrl === url) {
            // The current image URL hasn't changed (same R2 path), so no update needed
            updated = true;
          }
          return msg;
        });
        if (updated) {
          console.log(`  Chat history OK (URLs unchanged)`);
        }
      }

      console.log(`  Done`);
    } catch (err) {
      console.error(`  FAILED:`, (err as Error).message);
    }
  }

  console.log("\nAll done.");
}

main();
