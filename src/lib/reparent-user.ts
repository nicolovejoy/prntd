import { eq } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import {
  design as designTable,
  order as orderTable,
  cartItem as cartItemTable,
  product as productTable,
  image as imageTable,
  imageGeneration as imageGenerationTable,
} from "@/lib/db/schema";

/**
 * Re-parent every user-owned row from one user id to another — the guest→
 * account claim (auth.ts onLinkAccount). One db.batch (#37): the anonymous
 * plugin deletes the anon user right after this runs, so a crash between
 * sequential updates used to orphan the not-yet-moved tables (cart, product)
 * for the cleanup to cascade away. Atomic now: all moved or none.
 *
 * chat_message follows via design_id; everything else owns a user/owner
 * column directly. `product` rows are the Shop compositions a
 * published image mirrors (composition slice 1) — owned via `product.ownerId`,
 * so a guest who published before signing up keeps the mirror. The Model B
 * `image` table denormalizes owner_id, so it re-parents directly here
 * (placement_render / conversation_image follow via design_id,
 * image_publication via its image). `image_generation.user_id` is a real FK to `user.id` and
 * outlives the generation (the row is only removed with the design), so a
 * guest who generated once and then signed up would make the anonymous
 * plugin's delete fail on that FK if it were left behind. When later
 * migration slices add user-owned tables, extend this list — the integration
 * test seeds one row per table as the checklist.
 */
export async function reparentUserData(
  db: typeof appDb,
  fromId: string,
  toId: string
): Promise<void> {
  if (fromId === toId) return;
  await db.batch([
    db.update(designTable).set({ userId: toId }).where(eq(designTable.userId, fromId)),
    db.update(orderTable).set({ userId: toId }).where(eq(orderTable.userId, fromId)),
    db.update(cartItemTable).set({ userId: toId }).where(eq(cartItemTable.userId, fromId)),
    db.update(productTable).set({ ownerId: toId }).where(eq(productTable.ownerId, fromId)),
    db.update(imageTable).set({ ownerId: toId }).where(eq(imageTable.ownerId, fromId)),
    db
      .update(imageGenerationTable)
      .set({ userId: toId })
      .where(eq(imageGenerationTable.userId, fromId)),
  ]);
}
