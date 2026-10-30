/* The Clerk host read out of a publishable key: what the CSP and the
 * connector's sign-in metadata both name. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { clerkFrontendHost, clerkIssuer } from "./clerk-host";

const keyFor = (prefix: string, host: string) => `${prefix}${Buffer.from(`${host}$`).toString("base64")}`;

test("a dev key and a live key each give their own host", () => {
  assert.equal(clerkFrontendHost(keyFor("pk_test_", "happy-cat-12.clerk.accounts.dev")), "happy-cat-12.clerk.accounts.dev");
  assert.equal(clerkFrontendHost(keyFor("pk_live_", "clerk.example.com")), "clerk.example.com");
});

test("the issuer is the host over https, with no trailing dollar or slash", () => {
  assert.equal(clerkIssuer(keyFor("pk_live_", "clerk.example.com")), "https://clerk.example.com");
  assert.equal(clerkIssuer(`  ${keyFor("pk_test_", "a.clerk.accounts.dev")}  `), "https://a.clerk.accounts.dev");
});

test("anything that is not a publishable key gives nothing", () => {
  for (const key of [undefined, "", "sk_test_abc", "pk_test_", keyFor("pk_test_", "bad host/with path")]) {
    assert.equal(clerkFrontendHost(key), null, String(key));
    assert.equal(clerkIssuer(key), null, String(key));
  }
});
