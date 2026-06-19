"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { storesEnabled } from "@/lib/flags";
import { storeShareUrl } from "@/lib/stores";
import * as svc from "@/lib/store-service";
import type { store as storeTable } from "@/lib/db/schema";

type Store = typeof storeTable.$inferSelect;

/** Client-readable: whether the Dashboard nav link + routes should show. */
export async function isStoresEnabled(): Promise<boolean> {
  return storesEnabled();
}

function assertEnabled() {
  if (!storesEnabled()) throw new Error("Stores are not enabled");
}

async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");
  return session.user.id;
}

/** Build the public share origin from the request, NOT NEXT_PUBLIC_APP_URL. */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export type DashboardStore = Store & { shareUrl: string; productCount: number };

/** The organizer's stores with share links + product counts for the back office. */
export async function getDashboard(): Promise<DashboardStore[]> {
  if (!storesEnabled()) return [];
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return [];
  const [stores, origin] = await Promise.all([
    svc.getMyStores(db, session.user.id),
    requestOrigin(),
  ]);
  return Promise.all(
    stores.map(async (s) => ({
      ...s,
      shareUrl: storeShareUrl(s.slug, origin),
      productCount: (await svc.getStoreProducts(db, s.id)).length,
    }))
  );
}

export async function createStore(input: {
  name: string;
  description?: string;
  accentColor?: string;
}): Promise<DashboardStore> {
  assertEnabled();
  const ownerId = await requireUserId();
  const store = await svc.createStore(db, ownerId, input);
  revalidatePath("/dashboard");
  const origin = await requestOrigin();
  return { ...store, shareUrl: storeShareUrl(store.slug, origin), productCount: 0 };
}

export async function updateStore(
  storeId: string,
  patch: svc.UpdateStoreInput
): Promise<Store> {
  assertEnabled();
  const ownerId = await requireUserId();
  const updated = await svc.updateStore(db, ownerId, storeId, patch);
  revalidatePath("/dashboard");
  return updated;
}
