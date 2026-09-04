"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { design as designTable } from "@/lib/db/schema";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { reopenConversation } from "@/app/design/actions";

/**
 * Reaching an image's conversation from the image detail page (studio-plan
 * slice 5). My Designs is a grid of images now, so this is the route back to
 * the thread that made one.
 *
 * A module of its own rather than another export on `d/actions.ts`: that file
 * is the read layer for the public Shop surfaces too (`getDiscoverFeed` on `/`
 * and `/prints`), and importing `design/actions` into it drags the whole
 * generation stack — the Anthropic client, R2, the generator registry —
 * into every one of those renders.
 */

/**
 * Open the conversation an image came from, bringing it back to the Studio
 * first if it had left.
 *
 * Two ways a conversation leaves the bench, and this undoes both: `closed_at`
 * (the 3-day sweep or an explicit Close) via the existing owner-gated
 * `reopenConversation`, and `status = 'archived'`, which is what deleteDesign
 * falls back to when an order references the design. Without the second, the
 * Studio's status filter would keep the lane off the bench and the page's
 * promise that opening returns it would be false.
 *
 * Archived only ever means "was ordered", so that is the status it goes back
 * to. Navigation is the caller's: the client pushes /design?id= once this
 * resolves.
 */
export async function openConversation(designId: string): Promise<void> {
  await reopenConversation(designId);

  // Owner-gated on its own account: reopenConversation returns early on an
  // already-open conversation, so its guard cannot be leaned on here.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");
  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });
  if (!found) throw new Error("Design not found");
  if (found.userId !== session.user.id) throw new Error("Unauthorized");

  if (found.status === "archived") {
    await db
      .update(designTable)
      .set({ status: "ordered", updatedAt: new Date() })
      .where(eq(designTable.id, designId));
  }

  // A reopened lane belongs back on the bench, off the archive list, and the
  // library's Archived marker is now wrong.
  revalidatePath("/studio");
  revalidatePath("/studio/archive");
  revalidatePath("/designs");
}
