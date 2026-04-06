"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { design as designTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createMockupTask, pollMockupTask } from "@/lib/printful";
import { getProductOrThrow, DEFAULT_PRODUCT_ID } from "@/lib/products";
import { uploadMockupImage } from "@/lib/r2";

export async function generateMockup(
  designId: string,
  colorName: string,
  productId: string = DEFAULT_PRODUCT_ID
): Promise<{ mockupUrl: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });
  if (!found || found.userId !== session.user.id)
    throw new Error("Unauthorized");
  if (!found.currentImageUrl) throw new Error("No design image");

  // Cache key includes product so different shirts don't collide
  const cacheKey = `${productId}:${colorName}`;
  const cached = found.mockupUrls?.[cacheKey];
  if (cached) return { mockupUrl: cached };

  // Look up product and variant
  const product = getProductOrThrow(productId);
  const variantId = product.variants[colorName]?.["M"];
  if (!variantId) throw new Error(`No variant for ${colorName} on ${product.name}`);

  // Generate mockup via Printful
  const taskKey = await createMockupTask(
    product.printfulProductId,
    variantId,
    found.currentImageUrl,
    product.mockupPosition
  );
  const { mockupUrl: tempUrl } = await pollMockupTask(taskKey);

  // Download and persist to R2
  const response = await fetch(tempUrl);
  const buffer = Buffer.from(await response.arrayBuffer());
  const r2Url = await uploadMockupImage(designId, colorName, buffer);

  // Update cache in DB
  const updatedMockups = { ...found.mockupUrls, [cacheKey]: r2Url };
  await db
    .update(designTable)
    .set({ mockupUrls: updatedMockups, updatedAt: new Date() })
    .where(eq(designTable.id, designId));

  return { mockupUrl: r2Url };
}
