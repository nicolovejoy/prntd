"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  design as designTable,
  designImage as designImageTable,
  order as orderTable,
} from "@/lib/db/schema";
import { eq, desc, and, not, count } from "drizzle-orm";

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

/**
 * Remove a design from the user's view. Hard-deletes when nothing else
 * references it; falls through to archive when orders are attached
 * (orders are financial records and never get cascaded). The UI button
 * stays "Delete" — the user's intent is "make this go away", and either
 * outcome satisfies that.
 *
 * Wrapped in a transaction so a failure on the parent delete doesn't
 * leave behind a design row with its design_image children already
 * nuked.
 */
export async function deleteDesign(designId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });

  if (!found) throw new Error("Design not found");
  if (found.userId !== session.user.id) throw new Error("Unauthorized");

  const [{ c: orderCount }] = await db
    .select({ c: count() })
    .from(orderTable)
    .where(eq(orderTable.designId, designId));

  if (orderCount > 0) {
    await db
      .update(designTable)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(designTable.id, designId));
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(designImageTable)
      .where(eq(designImageTable.designId, designId));
    await tx.delete(designTable).where(eq(designTable.id, designId));
  });
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
