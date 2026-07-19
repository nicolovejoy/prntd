/**
 * Remembered purchase defaults (#44, collapse plan §3): what product + size
 * the user bought last, for pre-selecting the buy surfaces. Deps-injected db
 * so the real-DB harness can exercise it.
 *
 * Guests/anonymous users get null — no localStorage fallback (§3); the claim
 * flow re-parents orders on sign-in, so history follows the account.
 */
import { and, asc, desc, eq, notInArray } from "drizzle-orm";
import {
  order as orderTable,
  orderItem as orderItemTable,
} from "@/lib/db/schema";
import { resolveOrderLines } from "@/lib/order-lines";
import { ACTIVE_BLANKS } from "@/lib/blanks";
import type { db as appDb } from "@/lib/db";
import type { PurchaseDefaults } from "@/lib/purchase-defaults";

type Db = typeof appDb;

export async function resolveLastPurchaseDefaults(
  db: Db,
  user: { id: string; isAnonymous?: boolean | null } | null | undefined
): Promise<PurchaseDefaults | null> {
  if (!user || user.isAnonymous) return null;

  // Most recent order that actually paid: pending never did, canceled
  // shouldn't re-seed.
  const [last] = await db
    .select()
    .from(orderTable)
    .where(
      and(
        eq(orderTable.userId, user.id),
        notInArray(orderTable.status, ["pending", "canceled"])
      )
    )
    .orderBy(desc(orderTable.createdAt))
    .limit(1);
  if (!last) return null;

  const items = await db
    .select()
    .from(orderItemTable)
    .where(eq(orderItemTable.orderId, last.id))
    .orderBy(asc(orderItemTable.createdAt));

  const [line] = resolveOrderLines(last, items);
  if (!line) return null;

  // A discontinued blank never comes back as a default (#44); its size is
  // meaningless without the blank, so the whole default drops.
  const blank = ACTIVE_BLANKS.find((b) => b.id === line.blankId);
  if (!blank) return null;

  return {
    blankId: blank.id,
    size: blank.sizes.includes(line.size) ? line.size : null,
  };
}
