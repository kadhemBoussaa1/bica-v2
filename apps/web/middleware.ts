import { NextResponse, type NextRequest } from "next/server";

/** Routes reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = ["/login"];

/**
 * Name of the Better Auth session cookie. The `__Secure-` prefix is added by
 * Better Auth when it issues cookies over HTTPS.
 */
const SESSION_COOKIE = "better-auth.session_token";

function hasSessionCookie(request: NextRequest) {
  return (
    request.cookies.has(SESSION_COOKIE) ||
    request.cookies.has(`__Secure-${SESSION_COOKIE}`)
  );
}

/**
 * Gates the app on the presence of a session cookie.
 *
 * This is a redirect for UX, NOT an authorization check: the cookie is only
 * checked for existence here, never verified. Middleware runs on the Next
 * origin while sessions are validated by the API, so a forged cookie would get
 * you a rendered shell and nothing else — every tRPC procedure still resolves
 * and authorizes the real session server-side.
 *
 * Note this reads a cookie set by the API on a different port. That works
 * because cookies ignore ports and both run on localhost. If the two are ever
 * served from different hostnames, this check stops seeing the cookie and must
 * move to an API call (or the cookie needs a shared parent Domain).
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  const signedIn = hasSessionCookie(request);

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Preserve where they were headed so login can send them back.
    if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (signedIn && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals, the favicon, and static assets.
  //
  // `manifest.webmanifest` is exempt because the browser fetches it WITHOUT
  // credentials: left in, it redirects to /login and the app cannot be
  // installed on the warehouse handheld. It names no data — see app/manifest.ts.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.png$).*)",
  ],
};
