import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/authCookies";

export function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE);
  const loginUrl = new URL("/login", request.url);
  if (!sessionCookie?.value) {
    return NextResponse.redirect(loginUrl);
  }
  const expirySeconds = Number(sessionCookie.value);
  if (Number.isFinite(expirySeconds) && expirySeconds * 1000 <= Date.now()) {
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/simulators/:path*",
    "/sessions/:path*",
    "/commands/:path*",
    "/metrics/:path*",
    "/faults/:path*",
    "/scenarios/:path*"
  ]
};
