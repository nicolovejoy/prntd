import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { createHash } from "crypto";
import { mockupObjectKey, type MockupKeyParts } from "@/lib/mockup-cache";

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const bucket = process.env.R2_BUCKET_NAME!;

export async function uploadDesignImage(
  designId: string,
  generationNumber: number,
  imageBuffer: Buffer,
  suffix?: string
): Promise<string> {
  const key = `designs/${designId}/${generationNumber}${suffix ? `-${suffix}` : ""}.png`;

  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: imageBuffer,
      ContentType: "image/png",
    })
  );

  // Return the public URL — assumes R2 bucket has public access or custom domain
  return `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? `https://${bucket}.r2.dev`}/${key}`;
}

export async function uploadMockupImage(
  designId: string,
  imageBuffer: Buffer,
  parts: MockupKeyParts
): Promise<string> {
  // The object key carries every part the mockupUrls cache key distinguishes
  // (#102: a key of just `{color}-{placement}.jpg` made every back-source /
  // product / scale choice overwrite one object, so cache entries served the
  // last-rendered artwork instead of their own). The content hash gives
  // re-renders a fresh URL so browser caches can't pin stale bytes.
  const contentHash = createHash("sha256")
    .update(imageBuffer)
    .digest("hex")
    .slice(0, 8);
  const key = mockupObjectKey(designId, parts, contentHash);

  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: imageBuffer,
      ContentType: "image/jpeg",
    })
  );

  return `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? `https://${bucket}.r2.dev`}/${key}`;
}

/**
 * Server-side copy of an R2 object identified by its public URL into a
 * new key under a different design. Returns the public URL of the copy.
 * Used by forkImage so each design owns its own R2 keys.
 */
export async function copyDesignImageByUrl(
  sourceUrl: string,
  newDesignId: string,
  newGenerationNumber: number
): Promise<string> {
  const publicBase =
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? `https://${bucket}.r2.dev`;
  if (!sourceUrl.startsWith(publicBase + "/")) {
    throw new Error("Source URL is not an R2 public URL on this bucket");
  }
  const sourceKey = sourceUrl.slice(publicBase.length + 1);
  const destKey = `designs/${newDesignId}/${newGenerationNumber}.png`;

  await r2.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: destKey,
      CopySource: `/${bucket}/${sourceKey}`,
    })
  );

  return `${publicBase}/${destKey}`;
}

/**
 * Delete a generation's R2 object by (design, generation number). Best-effort
 * orphan cleanup: called when a step after the upload fails, so a half-written
 * generation doesn't leave a stranded object under a reserved key.
 */
export async function deleteDesignImageObject(
  designId: string,
  generationNumber: number
): Promise<void> {
  await r2.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: `designs/${designId}/${generationNumber}.png`,
    })
  );
}

export async function getDesignImage(
  designId: string,
  generationNumber: number
): Promise<Buffer | null> {
  try {
    const result = await r2.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: `designs/${designId}/${generationNumber}.png`,
      })
    );
    const bytes = await result.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  } catch {
    return null;
  }
}
