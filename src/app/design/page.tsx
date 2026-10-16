import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { withNext } from "@/lib/safe-next";
import { conversationStudioHref } from "@/lib/studio-entry";
import { readSeedPrompt, seedHref } from "@/lib/studio-seed";
import { DesignEntry } from "./design-entry";

type Session = Awaited<ReturnType<typeof auth.api.getSession>>;

/**
 * Server component shell for /design. It never renders a thread (#188 slice
 * 2); the Studio is the make surface and this route is a doorway into it.
 *
 * With `?id=` (an old link to a conversation, a bookmark, a `next=` that
 * outlived the thread view) it redirects on the server:
 *   - a visitor with a session goes where `conversationStudioHref` says: that
 *     conversation's stage, or the bench when it has no result, is closed, is
 *     someone else's or does not exist. The redirect never writes, so a
 *     closed conversation is not reopened by a GET (ruling 6);
 *   - a visitor with none goes to sign-in and comes back here afterwards.
 *     Only a signed-in owner can be taken to a conversation, and a guest
 *     minted here would own nothing (R2).
 * `?id=` wins over `?prompt=` (R3). This redirect stays for good (ruling 7):
 * old `next=/design?id=…` values in sign-in links depend on it.
 *
 * With no `id` the landing page, the empty cart and "Order not found." still
 * link here because /design is the one route the proxy opens to a request with
 * no session cookie (while the guest funnel is on); /studio sends that request
 * to sign-in. So:
 *   - a visitor who already has a session (a real user or a returning guest)
 *     is redirected on the server to the Studio, carrying the landing idea
 *     (R2: they skip the client hop);
 *   - a visitor with none gets DesignEntry, which mints the guest session and
 *     then replaces itself with the same Studio address.
 *
 * No generation starts from this route, so it sets no `maxDuration`.
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
  // on every render). It runs on every /design render, including the
  // ?prompt= landing entry, so a failure degrades to null (treated as
  // signed-out) instead of throwing: there is no error.tsx in src/app, so an
  // unguarded throw here would be a bare 500 on the app's hottest page.
  let session: Session = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (err) {
    console.error("design page session read failed:", err);
  }
  // redirect() throws, so every call below sits outside the session read's
  // try/catch above.
  if (id) {
    if (!session) {
      redirect(withNext("/sign-in", `/design?id=${encodeURIComponent(id)}`));
    }
    redirect(await conversationStudioHref(session.user.id, id));
  }
  // Read with parseSeed's rule: one non-blank prompt, else none. Every other
  // param is dropped, including any stale lane or seed id.
  const prompt = readSeedPrompt(sp);
  if (session) redirect(seedHref(prompt));
  return <DesignEntry prompt={prompt} />;
}
