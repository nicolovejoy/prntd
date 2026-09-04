"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { reopenConversation } from "@/app/design/actions";

/**
 * Reopen from the archive list and land back on the Studio (studio-plan
 * slice 4: "reopening returns the lane").
 *
 * The write itself is the existing `reopenConversation` — owner-gated there,
 * and a no-op on a conversation that is already open. This wrapper exists
 * only for what happens after: the lane belongs on the bench, so that is
 * where the user goes.
 */
export async function reopenFromArchive(designId: string) {
  await reopenConversation(designId);
  revalidatePath("/studio");
  revalidatePath("/studio/archive");
  // Outside any try: redirect signals by throwing.
  redirect("/studio");
}
