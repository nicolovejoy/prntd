import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, isAnonymousUser } from "@/lib/auth";
import {
  getDesignThreadData,
  type DesignThreadData,
} from "@/lib/design-thread";
import { readSeedPrompt, seedHref } from "@/lib/studio-seed";
import { DesignPageClient } from "./design-client";
import { DesignEntry } from "./design-entry";

type Session = Awaited<ReturnType<typeof auth.api.getSession>>;

/**
 * Generation now finishes in an `after()` continuation started by the
 * generateDesign server action. A server action inherits the segment config of
 * the route that RENDERED it, not an API route's — so this budget is what the
 * background render gets. 300s is Fluid's max and comfortably covers an
 * Ideogram generate/edit round trip plus the R2 upload.
 */
export const maxDuration = 300;

/**
 * Server component shell for /design.
 *
 * With no `id` it never renders the thread (#188 slice 2b). The landing page,
 * the empty cart and "Order not found." still link here because /design is the
 * one route the proxy opens to a request with no session cookie (while the
 * guest funnel is on); /studio sends that request to sign-in. So:
 *   - a visitor who already has a session (a real user or a returning guest)
 *     is redirected on the server to the Studio, carrying the landing idea
 *     (R2: they skip the client hop);
 *   - a visitor with none gets DesignEntry, which mints the guest session and
 *     then replaces itself with the same Studio address.
 *
 * For ?id= visits (the old thread, until slice 2c redirects it) it starts the
 * whole-thread fetch (chat + gallery in one payload) without awaiting it, so
 * the shell streams immediately and client-side navigation commits without
 * waiting on the queries; the client hydrates from its thread cache when warm
 * and from this payload otherwise.
 */
export default async function DesignPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const id = typeof sp.id === "string" ? sp.id : undefined;
  // One session read for the whole page (cookieCache makes this cheap — see
  // src/lib/auth.ts's 5-minute cookieCache — so this is not a DB round trip
  // on every render): the no-id branch (session → redirect, none → the thin
  // entry), the publish gate and loadThread's ownership check all share it.
  // A guest-funnel anonymous session is a real Better-Auth user row, so
  // publishing needs more than "is there a session" — see
  // publishImage's isAnonymousUser check, which this mirrors for the UI so a
  // guest never sees a Publish control that would just throw. This read now
  // runs on every /design render, including the ?prompt= landing entry, so a
  // failure degrades to null (treated as signed-out) instead of throwing —
  // there is no error.tsx in src/app, so an unguarded throw here would be a
  // bare 500 on the app's hottest page.
  let session: Session = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (err) {
    console.error("design page session read failed:", err);
  }
  if (!id) {
    // Read with parseSeed's rule: one non-blank prompt, else none. Every other
    // param is dropped, including any stale lane or seed id. redirect() throws,
    // so it sits outside the session read's try/catch above.
    const prompt = readSeedPrompt(sp);
    if (session) redirect(seedHref(prompt));
    return <DesignEntry prompt={prompt} />;
  }
  const canPublish = Boolean(session) && !isAnonymousUser(session?.user);
  const initialThreadPromise = loadThread(id, session);
  return (
    <DesignPageClient
      initialThreadPromise={initialThreadPromise}
      canPublish={canPublish}
    />
  );
}

async function loadThread(
  designId: string,
  session: Session
): Promise<DesignThreadData | null> {
  // Guests without a session, foreign threads, and missing designs all
  // resolve null — the client renders the empty-thread view, exactly as the
  // old mount-effect fetch did. This catch covers getDesignThreadData only
  // (the session read above has its own try/catch); a rejected promise here
  // would otherwise take down the stream.
  try {
    if (!session) return null;
    return await getDesignThreadData(designId, session.user.id);
  } catch (err) {
    console.error("design thread preload failed:", err);
    return null;
  }
}
