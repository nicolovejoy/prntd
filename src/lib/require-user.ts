import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, isAnonymousUser } from "@/lib/auth";

/**
 * Session gate for personal-record pages (/designs, /orders) rendered as
 * server components. Middleware already bounces cookie-less visitors; this
 * covers the remaining case — an anonymous guest session (#26) — with the
 * same redirect instead of the Unauthorized throw the old client-fetch
 * path surfaced as an error state.
 */
export async function requireRealUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || isAnonymousUser(session.user)) redirect("/sign-in");
  return session;
}
