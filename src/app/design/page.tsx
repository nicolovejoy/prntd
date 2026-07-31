import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  getDesignThreadData,
  type DesignThreadData,
} from "@/lib/design-thread";
import { DesignPageClient } from "./design-client";

/**
 * Server component shell for the /design thread (#127). For ?id= visits it
 * starts the whole-thread fetch (chat + gallery in one payload) without
 * awaiting it, so the shell streams immediately and client-side navigation
 * commits without waiting on the queries; the client hydrates from its
 * thread cache when warm and from this payload otherwise.
 */
export default async function DesignPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const id = typeof sp.id === "string" ? sp.id : undefined;
  const initialThreadPromise = id ? loadThread(id) : Promise.resolve(null);
  return <DesignPageClient initialThreadPromise={initialThreadPromise} />;
}

async function loadThread(designId: string): Promise<DesignThreadData | null> {
  // Guests without a session, foreign threads, and missing designs all
  // resolve null — the client renders the empty-thread view, exactly as the
  // old mount-effect fetch did. A rejected promise would take down the
  // stream, so unexpected errors degrade to null too.
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return null;
    return await getDesignThreadData(designId, session.user.id);
  } catch (err) {
    console.error("design thread preload failed:", err);
    return null;
  }
}
