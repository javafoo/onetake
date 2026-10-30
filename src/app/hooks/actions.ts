"use server";

import { revalidatePath } from "next/cache";

import type { ActionState } from "@/app/actions";
import { checkSavedHook } from "@/content/draft-edit";
import { writeHooksFor } from "@/content/hook-batch";
import { addHook, deleteHooks, markHookUsed, setHooksArchived, updateHookText } from "@/data/hooks";
import { type User } from "@/data/users";
import { guardedAction } from "@/lib/action-guard";
import { currentAvatar } from "@/lib/current-avatar";
import { InvalidRequestError } from "@/lib/errors";

/* The Hooks page. Every action here is free and starts no job: hooks are
   words, and words are saved, edited, archived and deleted in the request.
   Ids come from the browser, so every write is scoped to the session's user
   in `src/data/hooks.ts`; an id that is not hers changes nothing. */

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

function guarded(where: string, form: FormData, run: (user: User) => Promise<string>): Promise<ActionState> {
  return guardedAction<string, ActionState>(form, {
    where,
    run,
    done: (message) => ({ ok: true, message }),
    failed: (message) => ({ ok: false, message }),
  });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * New hooks from the writer; see `writeHooksFor`. Only the words are kept: a
 * caption is written when a hook becomes a reel, for that reel, not here.
 */
export async function writeHooksAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded("writeHooksAction", form, async (user) => {
    const avatar = await currentAvatar(user.id);
    // "Use my brand" is a checkbox, sent only when ticked; a form without the box at all is on.
    const brand = form.get("brandAsked") === null || form.get("useBrand") === "on";
    const { hooks } = await writeHooksFor(user, avatar?.id ?? null, { count: Number(text(form, "count")), brand });
    revalidatePath("/hooks");
    if (hooks.length === 0) return "The writer only repeated hooks you already have. Try again.";
    return `${plural(hooks.length, "hook")} written.`;
  });
}

/** A hook she wrote herself. Free: no writer, and the saved-hook limit, not the reel's. */
export async function addHookAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded("addHookAction", form, async (user) => {
    const hook = checkSavedHook(text(form, "hook"));
    const avatar = await currentAvatar(user.id);
    if (!avatar) throw new InvalidRequestError("Finish her setup first.");
    await addHook(user.id, avatar.id, hook);
    revalidatePath("/hooks");
    return "Hook added.";
  });
}

export async function editHookAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded("editHookAction", form, async (user) => {
    const hook = checkSavedHook(text(form, "text"));
    const saved = await updateHookText(user.id, text(form, "id"), hook);
    if (!saved) throw new InvalidRequestError("That hook is gone. Reload the page.");
    revalidatePath("/hooks");
    return "Saved.";
  });
}

export type HookBatchState = { ok: boolean; message: string };

/** Many at once from Select, or one from an open row. */
export async function archiveHooksAction(input: { ids: string[]; archived: boolean }): Promise<HookBatchState> {
  const form = new FormData();
  return guardedAction<string, HookBatchState>(form, {
    where: "archiveHooksAction",
    run: async (user) => {
      const ids = Array.isArray(input.ids) ? input.ids.map(String) : [];
      const changed = await setHooksArchived(user.id, ids, input.archived === true);
      if (changed === 0) throw new InvalidRequestError("Those hooks are gone. Reload the page.");
      revalidatePath("/hooks");
      return input.archived ? `${plural(changed, "hook")} archived.` : `${plural(changed, "hook")} back in your list.`;
    },
    done: (message) => ({ ok: true, message }),
    failed: (message) => ({ ok: false, message }),
  });
}

export async function deleteHooksAction(input: { ids: string[] }): Promise<HookBatchState> {
  const form = new FormData();
  return guardedAction<string, HookBatchState>(form, {
    where: "deleteHooksAction",
    run: async (user) => {
      const ids = Array.isArray(input.ids) ? input.ids.map(String) : [];
      const removed = await deleteHooks(user.id, ids);
      if (removed === 0) throw new InvalidRequestError("Those hooks are gone. Reload the page.");
      revalidatePath("/hooks");
      return `${plural(removed, "hook")} deleted.`;
    },
    done: (message) => ({ ok: true, message }),
    failed: (message) => ({ ok: false, message }),
  });
}

/** "Copy text": the words went to the clipboard, so the hook is marked as used by hand. */
export async function markHookCopiedAction(input: { id: string }): Promise<HookBatchState> {
  const form = new FormData();
  return guardedAction<string, HookBatchState>(form, {
    where: "markHookCopiedAction",
    run: async (user) => {
      const marked = await markHookUsed(user.id, String(input.id ?? ""), "copied");
      if (!marked) throw new InvalidRequestError("That hook is gone. Reload the page.");
      revalidatePath("/hooks");
      return "Copied.";
    },
    done: (message) => ({ ok: true, message }),
    failed: (message) => ({ ok: false, message }),
  });
}
