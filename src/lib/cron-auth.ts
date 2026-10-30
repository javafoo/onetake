import { timingSafeEqual } from "node:crypto";

/**
 * Whether an `Authorization` header is Vercel's cron call.
 *
 * Constant time and length-checked, and false for everybody when the secret is
 * unset or too short to be one: an endpoint that is open because a variable is
 * missing is worse than one that never runs.
 */
export function cronAuthorised(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header?.startsWith("Bearer ")) return false;
  const expected = Buffer.from(secret);
  const given = Buffer.from(header.slice("Bearer ".length));
  return expected.length === given.length && timingSafeEqual(expected, given);
}
