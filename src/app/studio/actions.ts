"use server";

import { headers } from "next/headers";
import { auth, isAnonymousUser } from "@/lib/auth";
import { getStudioLanesData, type StudioLane } from "@/lib/studio";

/**
 * The poll target for /studio: re-reads the whole surface (lanes, cells,
 * pending cells) so a settle, a new generation from another tab, and a
 * lazily-swept stale job all land in one response. Same gate as the page —
 * the Studio is a personal-record surface, so anonymous guests are refused
 * like signed-out callers.
 */
export async function getStudioLanes(): Promise<StudioLane[]> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || isAnonymousUser(session.user)) {
    throw new Error("Unauthorized");
  }
  return getStudioLanesData(session.user.id);
}
