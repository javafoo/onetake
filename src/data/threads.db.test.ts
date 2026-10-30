/* Agent threads against real Postgres: scoped to her account, a request id
 * taken once, writes that do not lose each other, the fact link, and the
 * thirty-day sweep.
 *
 *   pnpm exec tsx --env-file=.env.local --test src/data/threads.db.test.ts
 *
 * Skips without a database or before the `agent_threads` table exists. Every
 * row belongs to a `test_` user and is deleted afterwards. */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test, type TestContext } from "node:test";

import { eq, sql } from "drizzle-orm";

import { applyDelta } from "../agent/v2/thread";
import type { ThreadMessage } from "../agent/v2/types";
import { db, schema } from "../db/client";

import { addFact, listFacts } from "./memory";
import { claimTurn, countThreadsBefore, createThread, deleteThreadsBefore, getThread, listThreads, mutateThread } from "./threads";

const PREFIX = "test_threads_";
const A = `${PREFIX}${randomUUID()}`;
const B = `${PREFIX}${randomUUID()}`;
let avatarA = "";
let avatarB = "";

let checked: Promise<string | null> | undefined;
function unavailable(): Promise<string | null> {
  checked ??= (async () => {
    if (!process.env.DATABASE_URL) return "no DATABASE_URL: run with --env-file=.env.local to exercise the real SQL";
    try {
      const { rows } = await db().execute<{ present: number }>(sql`
        select count(*)::int as present from information_schema.tables
        where table_schema = 'public' and table_name in ('users', 'avatars', 'agent_threads', 'brand_memory')
      `);
      return Number(rows[0]?.present ?? 0) === 4 ? null : "agent_threads is not migrated yet";
    } catch (error) {
      return `database unreachable: ${error instanceof Error ? error.message : String(error)}`;
    }
  })();
  return checked;
}

async function ready(t: TestContext): Promise<boolean> {
  const why = await unavailable();
  if (why) t.skip(why);
  return !why;
}

before(async () => {
  if (await unavailable()) return;
  for (const id of [A, B]) await db().insert(schema.users).values({ id, email: `${id}@example.invalid` });
  const avatar = async (userId: string) =>
    (await db().insert(schema.avatars).values({ userId, name: "Test", kind: "avatar" }).returning({ id: schema.avatars.id }))[0].id;
  avatarA = await avatar(A);
  avatarB = await avatar(B);
});

after(async () => {
  if (await unavailable()) return;
  for (const id of [A, B]) await db().delete(schema.users).where(eq(schema.users.id, id));
});

const AT = "2026-10-06T09:00:00.000Z";
const her = (text: string): ThreadMessage => ({ role: "her", text, at: AT, requestId: randomUUID() });

test("a thread is hers: another account cannot read, list, claim or change it", async (t) => {
  if (!(await ready(t))) return;
  const thread = await createThread(A, avatarA);
  await assert.rejects(createThread(B, avatarA), /Avatar not found/);
  assert.equal(await getThread(B, thread.id), null);
  assert.equal(await claimTurn(B, thread.id, randomUUID()), false);
  assert.equal(await mutateThread(B, thread.id, (current) => ({ ...current, title: "taken" })), null);
  assert.equal((await getThread(A, thread.id))?.title, null);
  assert.equal(await getThread(A, "not-a-uuid"), null);

  // Only threads with a message are listed, newest first, this avatar only.
  assert.deepEqual(await listThreads(A, avatarA), []);
  await mutateThread(A, thread.id, (current) => applyDelta(current, { messages: [her("hello")], offers: [], spent: 0, title: "hello" }));
  assert.deepEqual((await listThreads(A, avatarA)).map((row) => row.title), ["hello"]);
  assert.deepEqual(await listThreads(B, avatarA), []);
  assert.deepEqual(await listThreads(A, avatarB), []);
});

test("a request id is taken once per turn", async (t) => {
  if (!(await ready(t))) return;
  const thread = await createThread(A, avatarA);
  const id = randomUUID();
  assert.equal(await claimTurn(A, thread.id, id), true);
  assert.equal(await claimTurn(A, thread.id, id), false, "a resent turn is answered once");
  assert.equal(await claimTurn(A, thread.id, randomUUID()), true);
});

test("two writes at once both land: neither loses the other's messages", async (t) => {
  if (!(await ready(t))) return;
  const thread = await createThread(A, avatarA);
  await Promise.all(
    ["one", "two", "three"].map((text) => mutateThread(A, thread.id, (current) => applyDelta(current, { messages: [her(text)], offers: [], spent: 1 }))),
  );
  const saved = await getThread(A, thread.id);
  assert.deepEqual(saved?.messages.map((message) => (message.role === "her" ? message.text : "")).sort(), ["one", "three", "two"]);
  assert.equal(saved?.spentCredits, 3);
});

test("a fact remembered in a thread names it, and outlives it", async (t) => {
  if (!(await ready(t))) return;
  const thread = await createThread(A, avatarA);
  const fact = await addFact(A, avatarA, "She ships on Sundays.", "agent", thread.id);
  const [row] = await db().select().from(schema.brandMemory).where(eq(schema.brandMemory.id, fact.id));
  assert.equal(row.threadId, thread.id);

  // Thirty days untouched, then the sweep: the thread goes, the fact stays.
  await db().update(schema.agentThreads).set({ updatedAt: new Date("2026-01-01T00:00:00Z") }).where(eq(schema.agentThreads.id, thread.id));
  const cutoff = new Date("2026-02-01T00:00:00Z");
  assert.equal(await countThreadsBefore(cutoff, A), 1);
  assert.equal(await countThreadsBefore(cutoff, B), 0);
  assert.equal(await deleteThreadsBefore(cutoff, A), 1);
  assert.equal(await getThread(A, thread.id), null);
  assert.ok((await listFacts(A, avatarA)).some((kept) => kept.text === "She ships on Sundays."));
});
