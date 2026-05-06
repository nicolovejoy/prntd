"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { design as designTable, designImage as designImageTable } from "@/lib/db/schema";
import { eq, desc, and, not } from "drizzle-orm";

export async function getUserDesigns() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const designs = await db.query.design.findMany({
    where: and(
      eq(designTable.userId, session.user.id),
      not(eq(designTable.status, "archived"))
    ),
    orderBy: desc(designTable.updatedAt),
    columns: {
      id: true,
      status: true,
      currentImageUrl: true,
      generationCount: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return designs;
}

export async function deleteDesign(designId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });

  if (!found) throw new Error("Design not found");
  if (found.userId !== session.user.id) throw new Error("Unauthorized");
  if (found.status === "ordered") {
    throw new Error("Cannot delete a design that has been ordered");
  }

  // design_image.design_id has a FK to design.id; clear children first.
  // primary_image_id is plain text (no FK), so the design row referencing
  // a now-deleted child is fine — we delete the parent immediately after.
  await db.delete(designImageTable).where(eq(designImageTable.designId, designId));
  await db.delete(designTable).where(eq(designTable.id, designId));
}

export async function archiveDesign(designId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });

  if (!found) throw new Error("Design not found");
  if (found.userId !== session.user.id) throw new Error("Unauthorized");

  await db
    .update(designTable)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(designTable.id, designId));
}
