import { NextRequest, NextResponse } from "next/server";

// Personal-records routes — always behind sign-in. Note startsWith matching:
// "/designs" stays protected even when "/design" is opened (the funnel route),
// because "/design/x".startsWith("/designs") is false. Same for /orders vs
// /order.
const ALWAYS_PROTECTED = ["/designs", "/orders", "/admin"];
// The design → preview → order funnel. Opened to signed-out visitors when
// GUEST_FUNNEL_ENABLED (#26) — a guest gets an anonymous session client-side
// and the auth gate moves to checkout. When the flag is off these stay gated.
const FUNNEL_ROUTES = ["/design", "/preview", "/order"];

export function middleware(request: NextRequest) {
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
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/designs", "/design/:path*", "/preview/:path*", "/order/:path*", "/orders/:path*", "/admin/:path*"],
};
