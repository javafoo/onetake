/* Who is allowed to use a private style kit.

   A private kit is not a feature flag, it is one account's locked design, and
   offering it to anyone else would be selling that account's look twice. So
   the rule is the dumbest one that cannot be spoofed — a fixed table from
   Clerk user id to the owner slug the engine already understands, resolved on
   the server from the session and never from anything the browser sent.

   Deliberately not: the avatar's name, which is user input. Deliberately not
   an environment variable either: a kit that quietly stops being private
   because a variable was unset on one deployment is the failure we cannot
   see. Adding an owner is a code change and a review. No kit is private today. */

/* A Map, not an object literal: a plain object answers "__proto__" and
   "constructor" with something truthy, and the one input to this function is a
   string that arrived over the wire. */
const PRIVATE_KIT_OWNERS = new Map<string, string>();

/**
 * The profile slug this account owns private kits under, or undefined when it
 * owns none. Pass it to `listKits` and `resolveKit`: with undefined they
 * behave exactly as they do for a stranger.
 */
export function kitOwnerSlug(userId: string): string | undefined {
  return PRIVATE_KIT_OWNERS.get(userId);
}
