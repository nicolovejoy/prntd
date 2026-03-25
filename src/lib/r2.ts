import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

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
  imageBuffer: Buffer
): Promise<string> {
  const key = `designs/${designId}/${generationNumber}.png`;

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
