"use server";

import { headers } from "next/headers";
import { auth, isAnonymousUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveLastPurchaseDefaults } from "@/lib/last-purchase";
import type { PurchaseDefaults } from "@/lib/purchase-defaults";

/**
 * Remembered defaults (#44, §3): the signed-in user's last purchase seeds
 * product + size on the buy surfaces (/d, /shop). Null for guests — no
 * localStorage fallback. Values are validated against the active catalog in
 * resolveLastPurchaseDefaults.
 *
 * `/preview` is a redirect now (#278 slice 4) and this is all that is left of
 * its actions; slice 6 moves this one out of the directory.
 */
export async function getLastPurchaseDefaults(): Promise<PurchaseDefaults | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || isAnonymousUser(session.user)) return null;
  return resolveLastPurchaseDefaults(db, session.user);
}
