/* Brand memory against real Postgres: every read and write is scoped to her
 * account, and an id from another account changes nothing.
 *
 *   pnpm exec tsx --env-file=.env.local --test src/data/memory.db.test.ts
 *
 * Skips until the `brand_memory` table is migrated (package P1 owns the
 * migration). Every row belongs to a `test_` user and is deleted afterwards. */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test, type TestContext } from "node:test";

import { eq, sql } from "drizzle-orm";

import { db, schema } from "../db/client";

import { addFact, deleteFact, editFact, listFacts, memoryLines } from "./memory";

const PREFIX = "test_memory_";
const A = `${PREFIX}${randomUUID()}`;
const B = `${PREFIX}${randomUUID()}`;
let avatarA = "";
let avatarA2 = "";
let avatarB = "";

let checked: Promise<string | null> | undefined;
function unavailable(): Promise<string | null> {
  checked ??= (async () => {
    if (!process.env.DATABASE_URL) return "no DATABASE_URL: run with --env-file=.env.local to exercise the real SQL";
    try {
      const { rows } = await db().execute<{ present: number }>(sql`
        select count(*)::int as present from information_schema.tables
        where table_schema = 'public' and table_name in ('users', 'avatars', 'brand_memory')
      `);
      return Number(rows[0]?.present ?? 0) === 3 ? null : "brand_memory is not migrated yet";
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
  avatarA2 = await avatar(A);
  avatarB = await avatar(B);
});

after(async () => {
  if (await unavailable()) return;
  for (const id of [A, B]) {
    await db().delete(schema.brandMemory).where(eq(schema.brandMemory.userId, id));
    await db().delete(schema.users).where(eq(schema.users.id, id));
  }
});

test("a fact is saved for one avatar, cleaned to one line, and listed newest first", async (t) => {
  if (!(await ready(t))) return;
  const first = await addFact(A, avatarA, "  She has   two kids.\n", "her");
  assert.equal(first.text, "She has two kids.");
  assert.equal(first.source, "her");
  // No thread id: on the real schema it must name an agent_threads row (P1 put a foreign key on it).
  await addFact(A, avatarA, "She moved to Lisbon in 2024.", "agent");
  const facts = await listFacts(A, avatarA);
  assert.deepEqual(facts.map((fact) => fact.text), ["She moved to Lisbon in 2024.", "She has two kids."]);
  assert.deepEqual(await listFacts(A, avatarA2), [], "another avatar of hers has its own memory");
  assert.deepEqual(memoryLines(facts), ["She moved to Lisbon in 2024.", "She has two kids."]);
});

test("B cannot add to A's avatar, read A's facts, edit them or delete them", async (t) => {
  if (!(await ready(t))) return;
  const fact = await addFact(A, avatarA, "She runs at six every morning.", "her");
  await assert.rejects(addFact(B, avatarA, "Planted by B.", "her"), /Avatar not found/);
  assert.deepEqual(await listFacts(B, avatarA), []);
  await editFact(B, fact.id, "Changed by B.");
  await deleteFact(B, fact.id);
  const still = (await listFacts(A, avatarA)).find((row) => row.id === fact.id);
  assert.equal(still?.text, "She runs at six every morning.");
  assert.deepEqual(await listFacts(B, avatarB), []);
});

test("her edit rewrites the words and makes the fact hers; delete removes it", async (t) => {
  if (!(await ready(t))) return;
  const fact = await addFact(A, avatarA, "She has a dog.", "agent");
  await editFact(A, fact.id, "She has two dogs.");
  const edited = (await listFacts(A, avatarA)).find((row) => row.id === fact.id);
  assert.equal(edited?.text, "She has two dogs.");
  assert.equal(edited?.source, "her");
  await deleteFact(A, fact.id);
  assert.equal((await listFacts(A, avatarA)).some((row) => row.id === fact.id), false);
});

test("empty words and ids that are not ids are refused or ignored, never a query error", async (t) => {
  if (!(await ready(t))) return;
  await assert.rejects(addFact(A, avatarA, "   ", "her"), /needs some words/);
  await editFact(A, "not-a-uuid", "words");
  await deleteFact(A, "not-a-uuid");
  assert.deepEqual(await listFacts(A, "not-a-uuid"), []);
});
