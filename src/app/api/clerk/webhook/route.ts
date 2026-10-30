import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";

import { deleteAccountData } from "@/account/delete";
import { logUnexpected } from "@/lib/errors";

/* Clerk tells us when an account goes away.
 *
 * Accounts live in Clerk and the `users` row is written the first time a
 * signed-in person is seen, which is why there has never been a webhook: there
 * was nothing to miss. Deletion is the exception. A person who deletes their
 * account in Clerk — or whom support deletes — never signs in again, so
 * nothing in this app would ever notice, and their photographs would sit in
 * private storage forever.
 *
 * Signature verified by Clerk's own `verifyWebhook`, which reads
 * CLERK_WEBHOOK_SIGNING_SECRET. Without that variable this answers 503 rather
 * than trusting an unsigned body: an endpoint that deletes accounts must never
 * be reachable by anyone who can guess its URL.
 *
 * Public in src/proxy.ts, because Clerk has no session; verified instead by
 * signature.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim()) {
    /* 503, not 500: nothing is broken, it has not been set up. Clerk retries a
       503, so events are not lost while the secret is being added. */
    return Response.json(
      { ok: false, error: "This webhook is not configured yet." },
      { status: 503 },
    );
  }

  let event;
  try {
    event = await verifyWebhook(request);
  } catch {
    // Never says why: a precise answer is a tool for forging the next attempt.
    return Response.json({ ok: false, error: "Signature check failed." }, { status: 400 });
  }

  try {
    if (event.type === "user.deleted") {
      /* Clerk sends `id` and a `deleted` flag. A soft delete is not a deletion
         and must not erase anything. */
      const { id, deleted } = event.data as { id?: string; deleted?: boolean };
      if (!id) return Response.json({ ok: true, ignored: "no id" });
      if (deleted === false) return Response.json({ ok: true, ignored: "not a deletion" });

      const result = await deleteAccountData(id);
      // Idempotent: a repeat delivery finds nothing and still answers 200.
      console.info(`clerk webhook: erased ${id} (existed: ${result.existed}, media: ${result.media})`);
      return Response.json({ ok: true, existed: result.existed });
    }

    return Response.json({ ok: true, ignored: event.type });
  } catch (error) {
    /* 500 so Clerk retries. The reference goes in the log, not in the body:
       nothing about why an internal step failed is the sender's business. */
    const reference = logUnexpected("clerk webhook", error);
    return Response.json({ ok: false, ref: reference }, { status: 500 });
  }
}
