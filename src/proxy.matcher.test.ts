/* The proxy's matcher, tested as the regular expression it is.
 *
 * `src/proxy.ts` itself cannot be imported here: it pulls in the Clerk
 * middleware and `next/server`, neither of which runs outside a Next request.
 * The matcher is a string, so the string is read out of the file and compiled.
 * That keeps the test honest about the one thing that matters — what the
 * pattern does to a path — without pretending to exercise the proxy body.
 *
 * Next compiles each matcher entry with path-to-regexp and matches it against
 * the pathname. The entries here are plain regular expressions wrapped in
 * `/(...)`, so compiling them directly is the same question.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./proxy.ts", import.meta.url)), "utf8");

/** The matcher entries, in order, as they are written in the file. */
function matcherEntries(): string[] {
  // Up to the closing bracket on its own line: the patterns themselves contain
  // character classes, so the first `]` in the file is not the end of the array.
  const block = /matcher:\s*\[\n([\s\S]*?)\n\s*\],/.exec(source);
  assert.ok(block, "src/proxy.ts still exports config.matcher as an array");
  return [...block[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));
}

const ENTRIES = matcherEntries();

/** True when any matcher entry covers this path, so the proxy would run. */
function proxied(pathname: string): boolean {
  return ENTRIES.some((entry) => new RegExp(`^${entry}$`).test(pathname));
}

test("the matcher covers app pages, including ids that look like files", () => {
  for (const pathname of [
    "/",
    "/library",
    "/library/favorites",
    "/create",
    "/hooks",
    "/onboarding/photos/roles",
    // /carousels/[id] with the id "x.png". This used to skip the proxy, and
    // with it the onboarding gate's pathname header.
    "/carousels/x.png",
    "/carousels/x.png/zip",
    "/onboarding/interview/offer.css",
  ]) {
    assert.equal(proxied(pathname), true, pathname);
  }
});

test("the matcher always covers the API, where the media route lives", () => {
  for (const pathname of ["/api/media/abc", "/api/jobs/1", "/api/clerk/webhook"]) {
    assert.equal(proxied(pathname), true, pathname);
  }
});

test("Next's own assets and real public files are left alone", () => {
  for (const pathname of ["/_next/static/a.js", "/_next/image", "/favicon.ico", "/logo.svg", "/logo.png"]) {
    assert.equal(proxied(pathname), false, pathname);
  }
});

test("a json path is not mistaken for a script", () => {
  // `js(?!on)` exists for this: /manifest.json is an app route, not an asset.
  assert.equal(proxied("/manifest.json"), true);
});

/* The public lists, read out of the file the same way: `isPublic` is not
 * exported, because nothing but the proxy may decide what is public. The
 * lists are plain string arrays, so the strings are the whole question. */
function stringArray(name: string): string[] {
  const block = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(source);
  assert.ok(block, `src/proxy.ts still declares ${name} as an array`);
  const code = block[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return [...code.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const PUBLIC_EXACT = stringArray("PUBLIC_EXACT");
const PUBLIC_PREFIXES = stringArray("PUBLIC_PREFIXES");

test("the public lists are read as written", () => {
  assert.ok(PUBLIC_EXACT.includes("/api/clerk/webhook"));
  assert.ok(PUBLIC_PREFIXES.includes("/sign-in"));
});

/** The proxy's own rule, over the lists as written. */
function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

test("nothing private is public by accident", () => {
  for (const pathname of ["/api/mcp", "/api/jobs/x", "/api/agent/x", "/api/media/x", "/api/cron/jobs/x", "/api/cron", "/library", "/.well-known/oauth-authorization-server", "/api/stripe/webhook"]) {
    assert.equal(isPublic(pathname), false, pathname);
  }
});

test("the cron checks CRON_SECRET for itself, and only its exact path is public", () => {
  for (const pathname of ["/api/cron/jobs"]) {
    assert.equal(isPublic(pathname), true, pathname);
    assert.equal(proxied(pathname), true, pathname);
  }
  for (const pathname of ["/api/cron", "/api/cron/", "/api/cron/jobs/", "/api/cron/jobs/x", "/api/cron/email", "/api/cron/retention"]) {
    assert.equal(isPublic(pathname), false, pathname);
  }
});
