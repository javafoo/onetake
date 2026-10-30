import type { NextConfig } from "next";

import { clerkFrontendHost } from "./src/lib/clerk-host";

/* Rendering has to work in a serverless function, which means three things
   that are simply on disk locally have to be inside the deployed bundle:

   - ffmpeg. There is none on Vercel, so `ffmpeg-static` ships one. It is a
     binary, not code, so it is marked external (required at runtime, never
     bundled) and its folder is traced in by hand.
   - `@napi-rs/canvas`. A native addon, same reason. The `.node` file lives in
     a platform package (`@napi-rs/canvas-linux-x64-gnu` on Vercel), which the
     tracer will not find by following imports.
   - `assets/fonts`. Read at runtime by path, so nothing imports it and nothing
     traces it.

   `.npmrc` sets `node-linker=hoisted`, so `node_modules` is a flat tree of real
   directories. With pnpm's default symlinked layout these same paths resolve
   through symlinks, and Vercel refuses the function package ("files in
   symlinked directories"). That only shows up on a real deployment. */
const RUNTIME_FILES = [
  "assets/fonts/*",
  // The static ffmpeg build and the two files that hand out its path.
  "node_modules/ffmpeg-static/ffmpeg",
  "node_modules/ffmpeg-static/index.js",
  "node_modules/ffmpeg-static/package.json",
  // The canvas addon: the loader, and the platform package holding the .node.
  "node_modules/@napi-rs/canvas/*.js",
  "node_modules/@napi-rs/canvas/package.json",
  // With the flat layout set in .npmrc the platform package sits beside the loader.
  "node_modules/@napi-rs/canvas-*/*.node",
  "node_modules/@napi-rs/canvas-*/package.json",
];

/* ---------------------------------------------------------------------------
   Response headers.

   The Content-Security-Policy is the only interesting one. Clerk loads its
   own script from the instance's frontend API host, which is encoded in the
   publishable key, so the policy is built from that key rather than from a
   wildcard: a dev instance and a production instance get different hosts and
   neither has to be written down twice.

   No nonce. A nonce has to be minted per request in the proxy and threaded
   into every inline script, which means every page renders dynamically; these
   pages already do, but Clerk's own injected scripts are not ours to nonce.
   'unsafe-inline' in script-src is therefore the honest setting, and it is
   what the rest of the policy is built to survive: no object, no base tag, no
   framing, forms only back to this site.
   ------------------------------------------------------------------------- */

function contentSecurityPolicy(): string {
  const development = process.env.NODE_ENV !== "production";
  const frontend = clerkFrontendHost(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  /* The instance host serves clerk.browser.js and answers the client's API
     calls. The wildcards cover the satellite hosts Clerk redirects to during
     sign-in on a development instance. */
  const clerk = [
    ...(frontend ? [`https://${frontend}`] : []),
    "https://*.clerk.accounts.dev",
    "https://*.clerk.com",
  ];

  return [
    "default-src 'self'",
    // Next's bootstrap and Clerk's loader are both inline. React uses eval in
    // development to rebuild server stacks in the browser; production does not.
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""} ${clerk.join(" ")} https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    // Fonts are self-hosted by next/font at build time; nothing external.
    "font-src 'self' data:",
    // blob: is the carousel preview; https://img.clerk.com is the avatar.
    "img-src 'self' data: blob: https://img.clerk.com",
    "media-src 'self' blob:",
    `connect-src 'self' ${clerk.join(" ")} https://clerk-telemetry.com${development ? " ws: http://localhost:*" : ""}`,
    "worker-src 'self' blob:",
    // Clerk's bot check renders in a Cloudflare frame.
    "frame-src 'self' https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/* Enforced, not Report-Only: the policy above was checked in a browser against
   a real sign-in, hook writing and the carousel pages before this was flipped.
   Set CSP_REPORT_ONLY=1 to fall back to observing if a later change needs it. */
const CSP_HEADER = process.env.CSP_REPORT_ONLY === "1" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";

const nextConfig: NextConfig = {
  // Native addon and a binary: both have to be required at runtime, not bundled.
  serverExternalPackages: ["@napi-rs/canvas", "ffmpeg-static"],
  /* The agent's message can carry up to three screenshots, shrunk in the
     browser to about 1200px and re-encoded, so a few hundred kilobytes each.
     The default 1MB would refuse the third. */
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  /* The composer lived at /agent until it became Create. Old links and
     bookmarks still land; the query string (a `?hook=` from Hooks) rides along. */
  async redirects() {
    return [{ source: "/agent", destination: "/create", permanent: true }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Both, because X-Frame-Options is what older bots and scanners read.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: CSP_HEADER, value: contentSecurityPolicy() },
        ],
      },
    ];
  },
  outputFileTracingIncludes: {
    // The poll that finishes a clip, and every page whose action starts a job.
    "/api/jobs/[id]": RUNTIME_FILES,
    // The agent's poll: it starts and finishes the run's child jobs, so it renders reels and sets.
    "/api/agent/[id]": RUNTIME_FILES,
    "/api/health/render": RUNTIME_FILES,
    "/*": RUNTIME_FILES,
    /* Carousels draw with @napi-rs/canvas and the font files in every one of
       these: the job that renders a whole set, the server action that redraws
       one slide after an edit, and the sample tile behind the style picker.
       `/*` matches one segment, so a nested route has to be named. */
    "/carousels/new": RUNTIME_FILES,
    "/carousels/[id]": RUNTIME_FILES,
    "/carousels/[id]/zip": RUNTIME_FILES,
    "/carousels/kits/[kit]": RUNTIME_FILES,
  },
};

export default nextConfig;
