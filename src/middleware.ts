import { NextRequest, NextResponse } from "next/server";

const protectedRoutes = ["/design", "/preview", "/order"];

export function middleware(request: NextRequest) {
  const sessionToken = request.cookies.get("better-auth.session_token");

  if (
    !sessionToken &&
    protectedRoutes.some((route) => request.nextUrl.pathname.startsWith(route))
  ) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/design/:path*", "/preview/:path*", "/order/:path*"],
};
