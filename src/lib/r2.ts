import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";

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
  colorName: string,
  imageBuffer: Buffer,
  placementId: string = "front"
): Promise<string> {
  const slug = colorName.toLowerCase().replace(/\s+/g, "-");
  // Front keeps the legacy `{color}.jpg` key so already-cached URLs stay
  // valid; other placements get a `-{placement}` suffix so front/back
  // mockups for the same color don't overwrite each other.
  const suffix = placementId === "front" ? "" : `-${placementId}`;
  const key = `designs/${designId}/mockups/${slug}${suffix}.jpg`;

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
