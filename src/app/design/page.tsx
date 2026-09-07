import { headers } from "next/headers";
import { auth, isAnonymousUser } from "@/lib/auth";
import {
  getDesignThreadData,
  type DesignThreadData,
} from "@/lib/design-thread";
import { DesignPageClient } from "./design-client";

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
  // One session read for the whole page (cookieCache makes this cheap, and
  // the header already reads it on the same request): both the publish gate
  // below and loadThread's ownership check share it. A guest-funnel
  // anonymous session is a real Better-Auth user row, so publishing needs
  // more than "is there a session" — see publishImage's isAnonymousUser
  // check, which this mirrors for the UI so a guest never sees a Publish
  // control that would just throw.
  const session = await auth.api.getSession({ headers: await headers() });
  const canPublish = Boolean(session) && !isAnonymousUser(session?.user);
  const initialThreadPromise = id
    ? loadThread(id, session)
    : Promise.resolve(null);
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
  // old mount-effect fetch did. A rejected promise would take down the
  // stream, so unexpected errors degrade to null too.
  try {
    if (!session) return null;
    return await getDesignThreadData(designId, session.user.id);
  } catch (err) {
    console.error("design thread preload failed:", err);
    return null;
  }
}
