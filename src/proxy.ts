import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

import { PATHNAME_HEADER } from "./app/onboarding/flow";

/* Everything is private by default. A route has to be named here to be
   reachable signed out: the two auth screens, the Clerk webhook (Clerk has no
   session and the route verifies itself by signature), the health checks and
   the job sweep cron.

   Clerk's own guidance is that path matching here can drift from how Next.js
   actually routes a request, so this is the outer fence, not the only one: every
   page calls requireUser(), every server action re-checks the session, and
   /api/media/[id] looks the row up scoped to the signed-in user. */
// "/home" is the homepage's own pictures and reel in public/home, made for a made-up founder; nothing of anyone's account.
const PUBLIC_PREFIXES = ["/sign-in", "/sign-up", "/home"];
/* The render health check authenticates with its own token and answers 404
   without it. The Clerk webhook answers 503 until its signing secret is
   configured, rather than trusting an unsigned body. The cron is called by
   Vercel with no session and checks CRON_SECRET itself in an
   `Authorization: Bearer` header, answering 401 without it. */
const PUBLIC_EXACT = [
  // The homepage: the page itself shows the app to a signed-in account and the landing page to everyone else.
  "/",
  "/api/clerk/webhook",
  // The liveness ping an uptime monitor calls: one bit, no data, no secrets.
  "/api/health",
  "/api/health/render",
  // The every-minute job sweep: the CRON_SECRET check, see its route.
  "/api/cron/jobs",
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/* The root layout has to know which page is rendering, to send a half-set-up
   account into /onboarding and to drop the app shell while it is in there.
   A layout is given no pathname, so the one place that reliably sees every
   request puts it in a request header. Nothing is trusted from a client: an
   inbound copy is deleted before the real value is written. */
function withPathname(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.delete(PATHNAME_HEADER);
  headers.set(PATHNAME_HEADER, request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export default clerkMiddleware(async (auth, request) => {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return withPathname(request);

  /* A page gets the redirect; an API request gets 401. Redirecting /api/media
     would answer an <img> or <video> with the sign-in page at status 200, which
     the element would then fail to decode with no useful error. */
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    const { isAuthenticated } = await auth();
    if (!isAuthenticated) return new NextResponse("Not signed in", { status: 401 });
    return;
  }

  /* Signed out on a page: send them to sign in, and bring them back here after.
     Done explicitly rather than relying on `auth.protect()`'s default, which with
     production keys rewrote the page to a 404 instead of redirecting. */
  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated || !userId) {
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("redirect_url", request.url);
    return NextResponse.redirect(signIn);
  }
  return withPathname(request);
});

/* Everything except Next's own assets and the files in `public/`, plus always
   the API, where the media route lives.

   Two things about the exclusion are deliberate, and both were wrong before:

   - `[^/?]+` is one path segment. `public/` is served from the root, so a real
     static file is always a single segment. The old `[^?]*` spanned slashes,
     which meant an app route whose parameter happened to end in an extension
     (`/carousels/x.png` is `/carousels/[id]` with the id `x.png`) skipped the
     proxy entirely, and with it the onboarding gate's pathname header.
   - `$` puts the extension at the end of the path rather than anywhere in it,
     so `/x.png/anything` cannot buy its way out either.

   The gate fails safe as well (see `gateDecision`), because a matcher is a
   string and this is exactly the kind of string that drifts. */
export const config = {
  matcher: [
    "/((?!_next/|favicon\\.ico$|[^/?]+\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)(?:\\?.*)?$).*)",
    "/(api|trpc)(.*)",
  ],
};
