"use server";

import { revalidatePath } from "next/cache";

import { addFact, cleanFact, deleteFact, editFact, listFacts } from "@/data/memory";
import { guardedAction } from "@/lib/action-guard";
import { currentAvatar } from "@/lib/current-avatar";
import { InvalidRequestError } from "@/lib/errors";

/* The "What the agent remembers" card on the Brand page. Free, no job, no
   model call: a fact is a line of text saved in the request. Ids come from
   the browser, so every write goes through `src/data/memory.ts`, which
   scopes it to the session's user; an id that is not hers changes nothing.
   These live apart from `saveBrandAction` on purpose: that save rewrites the
   whole profile, and a fact is one row. */

export type MemoryState = { ok: boolean; message: string };

/** More than this per avatar is a document, not a memory; writers read only the newest 40. */
const MAX_FACTS = 100;

function run(where: string, work: (userId: string) => Promise<string>): Promise<MemoryState> {
  return guardedAction<string, MemoryState>(new FormData(), {
    where,
    run: async (user) => {
      const message = await work(user.id);
      revalidatePath("/brand");
      return message;
    },
    done: (message) => ({ ok: true, message }),
    failed: (message) => ({ ok: false, message }),
  });
}

function wordsOf(value: unknown): string {
  const line = cleanFact(typeof value === "string" ? value : "");
  if (!line) throw new InvalidRequestError("Write the fact first.");
  return line;
}

export async function addFactAction(input: { text: string }): Promise<MemoryState> {
  return run("addFactAction", async (userId) => {
    const text = wordsOf(input.text);
    const avatar = await currentAvatar(userId);
    if (!avatar) throw new InvalidRequestError("Finish her setup first.");
    if ((await listFacts(userId, avatar.id)).length >= MAX_FACTS) {
      throw new InvalidRequestError(`You have ${MAX_FACTS} facts saved. Delete one to add another.`);
    }
    await addFact(userId, avatar.id, text, "her");
    return "Saved. Writers will use it from now on.";
  });
}

export async function editFactAction(input: { id: string; text: string }): Promise<MemoryState> {
  return run("editFactAction", async (userId) => {
    await editFact(userId, String(input.id ?? ""), wordsOf(input.text));
    return "Saved.";
  });
}

export async function deleteFactAction(input: { id: string }): Promise<MemoryState> {
  return run("deleteFactAction", async (userId) => {
    await deleteFact(userId, String(input.id ?? ""));
    return "Deleted. Writers will not use it again.";
  });
}
