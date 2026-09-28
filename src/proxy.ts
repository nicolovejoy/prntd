import { NextRequest, NextResponse } from "next/server";

// Personal-records routes — a visitor with no session cookie is sent to
// sign-in. This only checks that a cookie exists; which sessions get in is
// each page's call. /orders refuses an anonymous guest-funnel session
// server-side (requireRealUser); /admin checks ADMIN_EMAIL. /studio and
// /designs (My Designs) admit one while GUEST_FUNNEL_ENABLED is on
// (requireStudioUser, #241): a guest's designs belong to their anonymous
// user, and these are the only places they are listed. A first visit with no
// cookie has nothing to list, so it still lands on sign-in from here.
//
// Note startsWith matching: "/designs" stays protected even when "/design"
// is opened (the funnel route), because "/design/x".startsWith("/designs") is
// false. Same for /orders vs /order. "/studio" covers /studio/library, which
// still exists as a 308 to /designs (nav model A, 2026-09-27), and
// /studio/archive, which 308s the same way (dropped as its own tab
// 2026-09-09).
//
// "/designs" is My Designs' own address now, not a redirect — it needs its
// own listing here just like "/studio". "/shop" is deliberately absent — the
// community feed is public.
const ALWAYS_PROTECTED = ["/designs", "/orders", "/admin", "/studio"];
// The design → preview → order funnel. Opened to signed-out visitors when
// GUEST_FUNNEL_ENABLED (#26) — a guest gets an anonymous session client-side
// and the auth gate moves to checkout. When the flag is off these stay gated.
const FUNNEL_ROUTES = ["/design", "/preview", "/order"];

export function proxy(request: NextRequest) {
  const sessionToken =
    request.cookies.get("better-auth.session_token") ||
    request.cookies.get("__Secure-better-auth.session_token");

  const guestFunnel = process.env.GUEST_FUNNEL_ENABLED === "true";
  const protectedRoutes = guestFunnel
    ? ALWAYS_PROTECTED
    : [...ALWAYS_PROTECTED, ...FUNNEL_ROUTES];

  if (
    !sessionToken &&
    protectedRoutes.some((route) => request.nextUrl.pathname.startsWith(route))
  ) {
    // Carry the intended destination — sign-in runs it through safeNextPath
    // and passes it on to sign-up, so a signed-out visitor lands where they
    // were headed instead of the default post-sign-in page.
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/designs", "/design/:path*", "/preview/:path*", "/order/:path*", "/orders/:path*", "/admin/:path*", "/studio", "/studio/:path*"],
};
