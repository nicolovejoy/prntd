import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
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

/**
 * Upload a generated/uploaded artifact or placement render under its own
 * id-keyed object (Model B slice 4, plan §6): `images/{id}.png`. The id is
 * minted before upload, so concurrent generations can't collide — no shared
 * counter involved. Legacy objects stay at `designs/{designId}/{n}.png` and
 * are never moved; their rows' image_url is authoritative.
 */
export async function uploadImageObject(
  imageId: string,
  imageBuffer: Buffer
): Promise<string> {
  const key = `images/${imageId}.png`;

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

// copyDesignImageByUrl (the Model A copy-based fork) was retired in Model B
// slice 3 — reuse is a conversation_image seed link, never an R2 copy.

/**
 * The object key behind a public image URL — legacy `designs/{designId}/{n}.png`
 * and id-keyed `images/{id}.png` alike. Null when the URL isn't in this bucket.
 */
export function imageKeyFromUrl(imageUrl: string): string | null {
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? `https://${bucket}.r2.dev`;
  if (!imageUrl.startsWith(`${base}/`)) return null;
  const key = imageUrl.slice(base.length + 1);
  return key.length > 0 ? key : null;
}

/**
 * Overwrite an image object in place, deriving the key from its stored public
 * URL so the URL never changes. Used by the legacy-alpha backfill (#153):
 * DB rows, order placements and Model B `image` rows all hold the URL, so
 * fixing the bytes under the same key fixes every reference at once.
 */
export async function overwriteImageObjectByUrl(
  imageUrl: string,
  imageBuffer: Buffer
): Promise<void> {
  const key = imageKeyFromUrl(imageUrl);
  if (!key) throw new Error(`URL is not in this bucket: ${imageUrl}`);
  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: imageBuffer,
      ContentType: "image/png",
    })
  );
}

/**
 * Delete an id-keyed R2 object (`images/{id}.png`). Best-effort orphan
 * cleanup: called when a step after the upload fails, so a half-written
 * generation doesn't leave a stranded object nothing references.
 */
export async function deleteImageObject(imageId: string): Promise<void> {
  await r2.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: `images/${imageId}.png`,
    })
  );
}

/** Fetch an id-keyed image object's bytes, or null when absent. */
export async function getImageObject(imageId: string): Promise<Buffer | null> {
  try {
    const result = await r2.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: `images/${imageId}.png`,
      })
    );
    const bytes = await result.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  } catch {
    return null;
  }
}
