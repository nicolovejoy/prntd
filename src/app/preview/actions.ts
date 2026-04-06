"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { design as designTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  createMockupTask,
  pollMockupTask,
  TSHIRT_VARIANTS,
} from "@/lib/printful";
import { uploadMockupImage } from "@/lib/r2";

export async function generateMockup(
  designId: string,
  colorName: string
): Promise<{ mockupUrl: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });
  if (!found || found.userId !== session.user.id)
    throw new Error("Unauthorized");
  if (!found.currentImageUrl) throw new Error("No design image");

  // Check cache
  const cached = found.mockupUrls?.[colorName];
  if (cached) return { mockupUrl: cached };

  // Look up a representative variant ID (size M) for this color
  const variants = TSHIRT_VARIANTS[colorName];
  if (!variants) throw new Error(`Unknown color: ${colorName}`);
  const variantId = variants["M"];

  // Generate mockup via Printful
  const taskKey = await createMockupTask(variantId, found.currentImageUrl);
  const { mockupUrl: tempUrl } = await pollMockupTask(taskKey);

  // Download and persist to R2
  const response = await fetch(tempUrl);
  const buffer = Buffer.from(await response.arrayBuffer());
  const r2Url = await uploadMockupImage(designId, colorName, buffer);

  // Update cache in DB
  const updatedMockups = { ...found.mockupUrls, [colorName]: r2Url };
  await db
    .update(designTable)
    .set({ mockupUrls: updatedMockups, updatedAt: new Date() })
    .where(eq(designTable.id, designId));

  return { mockupUrl: r2Url };
}
