import { and, asc, eq, sql } from "drizzle-orm";

import { db, schema } from "@/db/client";
import { InvalidRequestError } from "@/lib/errors";

import { isUuid } from "./ids";
import { LIBRARY_KINDS, type MediaKind } from "./media";

/* Folders in the library.
 *
 * One flat list per account. A folder is a label an item carries, not a place
 * the item lives: the media row keeps its kind and its bytes wherever it is
 * filed, and deleting a folder sends its items back to "not in a folder"
 * rather than deleting them (the foreign key does that, `on delete set null`).
 * A folder is not typed by kind, so the same one can hold the photos from a
 * shoot, the clips animated from them and the reels printed on those; each
 * tab of the library shows its own share and says how many. */

export type Folder = typeof schema.folders.$inferSelect;

export { MAX_FOLDER_NAME, MAX_FOLDERS, NO_FOLDER } from "./folder-rules";
import { cleanFolderName, folderNameProblem, MAX_FOLDERS, NO_FOLDER } from "./folder-rules";

/**
 * A folder name a person typed, made storable. Throws a sentence fit to show
 * when nothing usable is left.
 */
export function normaliseFolderName(raw: unknown): string {
  const name = cleanFolderName(raw);
  const problem = folderNameProblem(name);
  if (problem) throw new InvalidRequestError(problem);
  return name;
}

/**
 * Reads a folder choice off a form or a URL: a folder id, "none", or nothing.
 * `undefined` means the caller did not say; `null` means "not in a folder".
 * Anything else that is not a UUID is refused rather than guessed.
 */
export function folderChoice(value: unknown): string | null | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return undefined;
  if (text === NO_FOLDER) return null;
  if (!isUuid(text)) throw new InvalidRequestError("That folder does not exist.");
  return text;
}

export async function listFolders(userId: string): Promise<Folder[]> {
  return db().select().from(schema.folders).where(eq(schema.folders.userId, userId)).orderBy(asc(schema.folders.createdAt));
}

export async function getFolder(userId: string, folderId: string): Promise<Folder | null> {
  if (!isUuid(folderId)) return null;
  const [row] = await db()
    .select()
    .from(schema.folders)
    .where(and(eq(schema.folders.id, folderId), eq(schema.folders.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * The folder a form named, checked to be this user's. `undefined` when the form
 * said nothing, `null` for "not in a folder". A folder id that is not theirs is
 * refused the same way a malformed one is: neither exists as far as they know.
 */
export async function requireOwnFolder(userId: string, value: unknown): Promise<string | null | undefined> {
  const choice = folderChoice(value);
  if (!choice) return choice;
  const folder = await getFolder(userId, choice);
  if (!folder) throw new InvalidRequestError("That folder does not exist.");
  return folder.id;
}

export async function createFolder(userId: string, rawName: string): Promise<Folder> {
  const name = normaliseFolderName(rawName);
  /* Counted and inserted in one statement, for the same reason the media cap
     is (see `saveMediaCappedAcross`): a count followed by an insert is not a
     cap. Two taps on "New folder" may still make two folders with the same
     name, and that is fine — folders are labels, and a duplicate label is
     renamed or deleted in one tap. */
  const { rows } = await db().execute<{ id: string }>(sql`
    insert into folders (user_id, name)
    select ${userId}, ${name}
    where (select count(*) from folders where user_id = ${userId}) < ${MAX_FOLDERS}
    returning id
  `);
  if (rows.length === 0) throw new InvalidRequestError(`You already have ${MAX_FOLDERS} folders. Delete one you no longer use.`);
  const folder = await getFolder(userId, rows[0].id);
  if (!folder) throw new Error("The folder was inserted but could not be read back");
  return folder;
}

export async function renameFolder(userId: string, folderId: string, rawName: string): Promise<Folder | null> {
  if (!isUuid(folderId)) return null;
  const name = normaliseFolderName(rawName);
  const [row] = await db()
    .update(schema.folders)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(schema.folders.id, folderId), eq(schema.folders.userId, userId)))
    .returning();
  return row ?? null;
}

/** Removes the folder. Its items stay in the library, unfiled. */
export async function deleteFolder(userId: string, folderId: string): Promise<boolean> {
  if (!isUuid(folderId)) return false;
  const rows = await db()
    .delete(schema.folders)
    .where(and(eq(schema.folders.id, folderId), eq(schema.folders.userId, userId)))
    .returning({ id: schema.folders.id });
  return rows.length > 0;
}

/** How many library items sit in each folder, by kind. Keyed by folder id; `""` is "not in a folder". */
export type FolderCounts = Record<string, Partial<Record<MediaKind, number>>>;

/** With `avatarId`, only that avatar's items (and rows from before items carried one), the way her shelves list them. */
export async function folderCounts(userId: string, kinds: readonly MediaKind[] = LIBRARY_KINDS, avatarId?: string): Promise<FolderCounts> {
  /* A take the judge rejected is kept out of every count, exactly as it is
     kept out of every shelf, so a folder never says "3" and shows two. */
  const { rows } = await db().execute<{ folder_id: string | null; kind: MediaKind; n: string }>(sql`
    select folder_id, kind, count(*) as n
    from media
    where user_id = ${userId}
      and kind = any(array[${sql.join(kinds.map((kind) => sql`${kind}`), sql`, `)}]::text[])
      and coalesce(meta->>'keep', 'true') <> 'false'
      ${avatarId ? sql`and (avatar_id = ${avatarId} or avatar_id is null)` : sql``}
    group by folder_id, kind
  `);
  const counts: FolderCounts = {};
  for (const row of rows) {
    const key = row.folder_id ?? "";
    (counts[key] ??= {})[row.kind] = Number(row.n);
  }
  return counts;
}

/** Sum of one kind across every folder, from a `folderCounts` result. */
export function totalOf(counts: FolderCounts, kind: MediaKind): number {
  return Object.values(counts).reduce((sum, byKind) => sum + (byKind[kind] ?? 0), 0);
}
