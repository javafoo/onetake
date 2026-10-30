/* Put credits on an account by hand.
 *
 *   pnpm grant:credits <clerkUserId> <credits> [note]
 *
 * Writes one `adjustment` row in `credit_ledger`, which is what the balance is
 * the sum of. Use it to give a reviewer's account more than the free credits,
 * or to make good on a job that went wrong. A negative number takes credits
 * away. Nobody can buy credits; this is the only way more arrive.
 *
 * `note` doubles as the idempotency key: running this twice with the same user,
 * reason and note writes one row. Leave it out and every run adds credits.
 * A negative grant needs a note, so a repeat run cannot take the credits twice.
 */

import { grant } from "../src/billing/credits";
import { dbCreditStore } from "../src/billing/store.db";
import { getUser } from "../src/data/users";

const [userId, amount, ...rest] = process.argv.slice(2);
const note = rest.join(" ").trim() || null;

const USAGE = [
  "usage: pnpm grant:credits <clerkUserId> <credits> [note]",
  "  note is the idempotency key: the same user, reason and note writes one row.",
  "  A negative number needs a note, so a repeat run is a no-op instead of a second deduction.",
].join("\n");

if (!userId || !amount) {
  console.error(USAGE);
  process.exit(1);
}

const credits = Number(amount);
if (!Number.isInteger(credits) || credits === 0) {
  console.error(`credits must be a whole number other than zero, got ${amount}`);
  process.exit(1);
}

if (credits < 0 && !note) {
  console.error(`a negative grant needs a note, so a repeat run cannot take the credits twice.\n${USAGE}`);
  process.exit(1);
}

const user = await getUser(userId);
if (!user) {
  console.error(`No user ${userId}. They have to sign in once before anything can be granted to them.`);
  process.exit(1);
}

const before = await dbCreditStore.balance(userId);

// `grant` refuses a negative amount, because nothing in the app should ever
// take credits away without a job to point at. A hand-written deduction is the
// one exception, and it is written here where it is visible.
const written =
  credits > 0
    ? await grant(userId, credits, "adjustment", note)
    : await dbCreditStore.grant({ userId, credits, reason: "adjustment", note });

const after = await dbCreditStore.balance(userId);

if (!written) {
  console.log(`Nothing written: ${user.email} already has an adjustment noted "${note}".`);
} else {
  console.log(`${credits > 0 ? "+" : ""}${credits} credits for ${user.email} (${userId})`);
  if (note) console.log(`note: ${note}`);
}
console.log(`balance: ${before} -> ${after}`);
