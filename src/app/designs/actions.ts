"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { design as designTable } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function getUserDesigns() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const designs = await db.query.design.findMany({
    where: eq(designTable.userId, session.user.id),
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
  if (found.status !== "draft") {
    throw new Error("Cannot delete a design that has been approved or ordered");
  }

  await db.delete(designTable).where(eq(designTable.id, designId));
}
