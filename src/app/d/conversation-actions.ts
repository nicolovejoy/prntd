"use server";

import { revalidatePath } from "next/cache";
import { reopenConversation } from "@/app/design/actions";

/**
 * Reaching an image's conversation from the image detail page (studio-plan
 * slice 5). My Designs is a grid of images now, so this is the route back to
 * the thread that made one.
 *
 * A module of its own rather than another export on `d/actions.ts`: that file
 * is imported by the public buy path, and pulling `design/actions` into it
 * drags the whole generation stack (the Anthropic client, R2, the generator
 * registry) along with it.
 */

/**
 * Open the conversation an image came from, reopening it first when it has
 * archived out of the Studio.
 *
 * The write is the existing `reopenConversation` — owner-gated there, and a
 * no-op on a conversation that is already open, so a user who never archived
 * anything pays nothing for this path. Navigation is the caller's: the client
 * pushes /design?id= once this resolves.
 */
export async function openConversation(designId: string): Promise<void> {
  await reopenConversation(designId);
  // A reopened lane belongs back on the bench, and off the archive list.
  revalidatePath("/studio");
  revalidatePath("/studio/archive");
}
