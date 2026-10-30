/* Where this app's Clerk instance lives, read from its publishable key.

   A publishable key is `pk_test_<base64>` or `pk_live_<base64>`, and the
   base64 is the instance's frontend API host with a `$` on the end. Two places
   need that host: the Content-Security-Policy in next.config.ts, which lets
   Clerk's script load from it, and the Claude connector's sign-in metadata,
   which names it as the authorization server. Reading it here, once, means a
   dev key and a live key each point both at the same host and neither has to
   be written down.

   Pure and dependency-free, because next.config.ts imports it before anything
   else in the app is loaded. */

/** The frontend API host encoded in a Clerk publishable key, or null when the key is missing or not one. */
export function clerkFrontendHost(publishableKey: string | undefined): string | null {
  const key = publishableKey?.trim();
  const encoded = key?.replace(/^pk_(test|live)_/, "");
  if (!encoded || encoded === key) return null;
  try {
    const host = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
    return /^[a-z0-9.-]+$/i.test(host) ? host : null;
  } catch {
    return null;
  }
}

/** The instance's issuer URL (`https://<host>`), which is what OAuth metadata names as the authorization server. */
export function clerkIssuer(publishableKey: string | undefined): string | null {
  const host = clerkFrontendHost(publishableKey);
  return host ? `https://${host}` : null;
}
