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
  // Everything except Next internals, the favicon, static assets, and the
  // installed app's plumbing (docs/pwa-plan.md). None of the exempt routes
  // reads data:
  //
  // - `manifest.webmanifest`: the browser fetches it WITHOUT credentials.
  //   Left in, it redirects to /login and the app cannot be installed on the
  //   warehouse handheld. It names no data — see app/manifest.ts.
  // - `sw.js`: signed out, a redirect instead of the script fails the
  //   service worker's registration, which starts on /login.
  // - `offline`: the worker caches it on install, signed out; gated, it
  //   would cache /login as the offline page.
  // - `push/describe`: words a push for the service worker from the kind
  //   and params it is given. It must answer a device whose session cookie
  //   has lapsed, or every push there reads "Bicapack".
  //
  // The lookahead is anchored right after the leading `/`, and the three
  // routes end in `$`, so `/offlinex` and `/foo/sw.js` stay gated.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw\\.js$|offline$|push/describe$|.*\\.png$).*)",
  ],
};
