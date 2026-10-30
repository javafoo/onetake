import { randomUUID } from "node:crypto";

import { unstable_rethrow } from "next/navigation";

import { isUuid } from "@/data/ids";
import { requireUser, type User } from "@/data/users";

import { userMessage } from "./errors";

/* The one retry guard, shared by every server action.
 *
 * There used to be three copies of this — src/app/actions.ts,
 * src/app/carousels/actions.ts, src/app/onboarding/actions.ts — and all three
 * keyed their in-memory map by the client's `requestId` alone. A request id is
 * the browser's, not ours: two accounts submitting the same id landed on the
 * same entry, so one account could be handed another's result, or could park
 * an id and collect whatever the other one ran under it. The fix is the order
 * of two lines: authenticate first, then key by `${user.id}:${requestId}`.
 *
 * The map is the fast path only. What actually makes a retry free is the
 * unique index on (user_id, request_id) in `jobs`, which survives a restart
 * and a second instance, and which `run` is handed the same id to pass on.
 */

const globalStore = globalThis as typeof globalThis & { __actionRuns?: Map<string, Promise<unknown>> };
const runs = (globalStore.__actionRuns ??= new Map());

/** Long enough to cover a retried delivery, short enough not to be a cache. */
const REMEMBER_MS = 10 * 60 * 1000;

/**
 * The id this submission is remembered under.
 *
 * Anything that is not a UUID gets a fresh one: the client's value names a
 * shared slot, so it has to be a shape a client cannot use to reach across
 * accounts or to collide on purpose. A form that sends nothing usable still
 * works, it simply loses the retry guard.
 */
export function requestIdFrom(supplied: unknown): string {
  const value = typeof supplied === "string" ? supplied.trim() : "";
  return isUuid(value) ? value : randomUUID();
}

/** The slot itself. The account comes first, and that is the whole fix. */
export function dedupeKey(userId: string, requestId: string): string {
  return `${userId}:${requestId}`;
}

export interface GuardOptions<Outcome, State> {
  /** Names this action in the server log when something unexpected fails. */
  where: string;
  run: (user: User, requestId: string) => Promise<Outcome>;
  /** The action's own success shape. */
  done: (outcome: Outcome) => State;
  /** The action's own refusal shape, given a sentence fit to show a person. */
  failed: (message: string) => State;
}

export async function guardedAction<Outcome, State>(
  form: FormData,
  options: GuardOptions<Outcome, State>,
): Promise<State> {
  /* A server action is a public endpoint: the session is checked here, before
     anything reads the form, and before the request id is allowed to name a
     shared slot. */
  let user: User;
  try {
    user = await requireUser();
  } catch (error) {
    unstable_rethrow(error);
    return options.failed(userMessage(options.where, error));
  }

  // The browser attaches one id per submission; the account it came from
  // decides which slot that id is allowed to name.
  const requestId = requestIdFrom(form.get("requestId"));
  const key = dedupeKey(user.id, requestId);

  const existing = runs.get(key) as Promise<State> | undefined;
  if (existing) return existing;

  const result = (async (): Promise<State> => {
    try {
      return options.done(await options.run(user, requestId));
    } catch (error) {
      // redirect() and notFound() work by throwing; they are not failures.
      unstable_rethrow(error);
      return options.failed(userMessage(options.where, error));
    }
  })();

  runs.set(key, result);
  // A rejection here is a redirect on its way out; nothing else may observe it.
  void result.catch(() => undefined);
  setTimeout(() => runs.delete(key), REMEMBER_MS).unref?.();
  return result;
}
