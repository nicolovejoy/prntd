/**
 * `/preview` was the design-your-own buy page. The image detail page replaced
 * it (one buy surface, #278 slice 4); this route stays so the links to it that
 * outlive the page still work: Stripe cancel and Back links from sessions
 * created before the change, `/order?…` (which forwards here), sign-in
 * `next=` values, bookmarks. `src/lib/preview-redirect.ts` decides where each
 * goes. A temporary redirect, because the answer depends on who is signed in
 * and on the conversation's current primary image.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolvePreviewRedirect } from "@/lib/preview-redirect";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function PreviewRedirectPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const sp = await searchParams;
  let viewerId: string | null = null;
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    viewerId = session?.user.id ?? null;
  } catch (err) {
    // Degrade to signed out (the redirect then offers sign-in), not a 500.
    console.error("/preview session read failed:", err);
  }
  // Outside the try: redirect() throws to do its work.
  redirect(await resolvePreviewRedirect(sp, viewerId));
}
