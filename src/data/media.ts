import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { db, schema } from "@/db/client";
import { getStorage } from "@/lib/get-storage";
import { mediaPathname, userPrefix } from "@/lib/storage";
import { readAll } from "@/lib/stream";

import { cleanHookText } from "./hook-rules";
import { isUuid } from "./ids";

/* Media bytes live in private Blob storage; this table holds the pathname and
   everything the pages need to render without touching storage. Nothing here
   returns a storage URL: pages link to /api/media/<id>, which checks the owner. */

export type Media = typeof schema.media.$inferSelect;
export type MediaKind = Media["kind"];

export const mediaUrl = (id: string) => `/api/media/${id}`;

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "application/json": "json",
  "text/plain": "txt",
};

export function extensionFor(contentType: string): string {
  return EXTENSIONS[contentType.split(";")[0].trim().toLowerCase()] ?? "bin";
}

export type SaveMediaInput = {
  kind: MediaKind;
  data: Buffer;
  contentType: string;
  avatarId?: string | null;
  /** The library folder this lands in. Null or absent is "not in a folder". */
  folderId?: string | null;
  meta?: Record<string, unknown>;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  /** Supplied by the import script so a second run overwrites instead of duplicating. */
  id?: string;
};

export async function saveMedia(userId: string, input: SaveMediaInput): Promise<Media> {
  const id = input.id ?? randomUUID();
  const pathname = mediaPathname(userId, input.kind, id, extensionFor(input.contentType));
  const stored = await getStorage().put(pathname, input.data, input.contentType);

  const values = {
    id,
    userId,
    avatarId: input.avatarId ?? null,
    folderId: input.folderId ?? null,
    kind: input.kind,
    pathname: stored.pathname,
    contentType: stored.contentType,
    bytes: stored.bytes,
    width: input.width ?? null,
    height: input.height ?? null,
    durationSeconds: input.durationSeconds == null ? null : String(input.durationSeconds),
    meta: input.meta ?? {},
  };

  const [row] = await db()
    .insert(schema.media)
    .values(values)
    .onConflictDoUpdate({
      target: schema.media.id,
      set: { ...values, id: undefined, userId: undefined },
      setWhere: eq(schema.media.userId, userId),
    })
    .returning();
  return row;
}

/** Thrown when a capped insert found the cap already reached. */
export class MediaLimitReachedError extends Error {
  readonly limit: number;

  constructor(limit: number) {
    super(`This account already has ${limit} of these.`);
    this.name = "MediaLimitReachedError";
    this.limit = limit;
  }
}

/**
 * Save a row only while this user has fewer than `limit` of `kind` on `avatarId`.
 *
 * `checkUpload({ existing })` counted first and `saveMedia` wrote second, which
 * is two round trips with a gap in the middle: two hundred concurrent POSTs all
 * read fifteen-or-fewer and all wrote, so the cap was advisory. The count and
 * the insert are now one statement, and that statement runs behind a
 * transaction-scoped advisory lock keyed on the user — the pattern the comment
 * at the top of `src/billing/store.db.ts` explains, and the only one available
 * because the Neon HTTP driver has no interactive transactions. Under READ
 * COMMITTED the second statement in a batch takes its snapshot after the lock
 * is granted, so it sees every insert that committed before it.
 *
 * The bytes go to storage first and are deleted again if the row is refused: an
 * orphaned object costs pennies, a row with no bytes behind it is a broken
 * photo on her screen.
 */
export async function saveMediaCapped(
  userId: string,
  input: SaveMediaInput & { avatarId: string },
  limit: number,
): Promise<Media> {
  const id = input.id ?? randomUUID();
  const pathname = mediaPathname(userId, input.kind, id, extensionFor(input.contentType));
  const stored = await getStorage().put(pathname, input.data, input.contentType);

  try {
    const [, inserted] = await db().batch([
      db().execute(sql`select pg_advisory_xact_lock(hashtextextended(${`media:${userId}:${input.kind}`}, 0))`),
      db().execute<{ id: string }>(sql`
        insert into media (id, user_id, avatar_id, kind, pathname, content_type, bytes, width, height, meta)
        select ${id}::uuid, ${userId}, ${input.avatarId}::uuid, ${input.kind}, ${stored.pathname},
               ${stored.contentType}, ${stored.bytes}, ${input.width ?? null}, ${input.height ?? null},
               ${JSON.stringify(input.meta ?? {})}::jsonb
        where (
          select count(*) from media
          where user_id = ${userId} and kind = ${input.kind} and avatar_id = ${input.avatarId}::uuid
            and coalesce(meta->>'retired', 'false') <> 'true'
        ) < ${limit}
        returning id
      `),
    ]);

    if (inserted.rows.length === 0) throw new MediaLimitReachedError(limit);
  } catch (error) {
    await getStorage().delete(stored.pathname).catch(() => undefined);
    throw error;
  }

  const row = await getMedia(userId, id);
  if (!row) throw new Error("The photo was inserted but could not be read back");
  return row;
}

/** The kinds that make up "her library": the shelves the Library page shows. */
export const LIBRARY_KINDS = ["image", "clip", "reel"] as const;
/** How many photos and clips one account may add from its own device. Only
    uploads count: what the app generates is paid for, and never refused for
    room. The cap is what bounds the storage an account can fill for free. */
export const UPLOAD_CAP = 200;

/* How many rows a Library shelf reads. A bound against a runaway, not a
   limit anyone should meet: the Library shows everything she has. It used to
   be the default of 200, which quietly dropped the oldest items off the grid
   once generations took an account past it. */
export const SHOW_ALL = 10_000;

/** The SQL test for "she added this herself": the rows the upload cap counts. */
const UPLOADED = sql`meta->>'source' = 'upload'`;

/** `kind = any(array[...])`, built from a list rather than interpolated. */
function kindList(kinds: readonly MediaKind[]) {
  return sql`array[${sql.join(kinds.map((kind) => sql`${kind}`), sql`, `)}]::text[]`;
}

/**
 * Save an upload only while this user has added fewer than `limit` photos and
 * clips of their own, across `kinds`.
 *
 * `saveMediaCapped` counts one kind on one avatar, which is the right shape for
 * the onboarding photo set. The upload cap is a different question — it is
 * about what she has added from her device, whichever avatar it hangs off — so
 * the count runs across kinds, is not scoped to an avatar, and counts uploads
 * only (`meta.source = "upload"`): generated photos never use up her room to
 * add her own.
 *
 * Same atomicity, for the same reason and by the same means: the count and the
 * insert are one statement, behind a transaction-scoped advisory lock keyed on
 * the user, because the Neon HTTP driver has no interactive transactions and a
 * cap enforced by a count followed by a write is not enforced at all. See the
 * comment at the top of `src/billing/store.db.ts`.
 *
 * The bytes go to storage first and are deleted again if the row is refused: an
 * orphaned object costs pennies, a row with no bytes behind it is a broken tile
 * on her screen.
 */
export async function saveMediaCappedAcross(
  userId: string,
  input: SaveMediaInput,
  kinds: readonly MediaKind[] = LIBRARY_KINDS,
  limit: number = UPLOAD_CAP,
): Promise<Media> {
  const id = input.id ?? randomUUID();
  const pathname = mediaPathname(userId, input.kind, id, extensionFor(input.contentType));
  const stored = await getStorage().put(pathname, input.data, input.contentType);

  try {
    const [, inserted] = await db().batch([
      db().execute(sql`select pg_advisory_xact_lock(hashtextextended(${`library:${userId}`}, 0))`),
      db().execute<{ id: string }>(sql`
        insert into media (id, user_id, avatar_id, folder_id, kind, pathname, content_type, bytes, width, height, duration_seconds, meta)
        select ${id}::uuid, ${userId}, ${input.avatarId ?? null}::uuid, ${input.folderId ?? null}::uuid, ${input.kind}, ${stored.pathname},
               ${stored.contentType}, ${stored.bytes}, ${input.width ?? null}, ${input.height ?? null},
               ${input.durationSeconds == null ? null : String(input.durationSeconds)}::numeric,
               ${JSON.stringify(input.meta ?? {})}::jsonb
        where (select count(*) from media where user_id = ${userId} and kind = any(${kindList(kinds)}) and ${UPLOADED}) < ${limit}
        returning id
      `),
    ]);

    if (inserted.rows.length === 0) throw new MediaLimitReachedError(limit);
  } catch (error) {
    await getStorage().delete(stored.pathname).catch(() => undefined);
    throw error;
  }

  const row = await getMedia(userId, id);
  if (!row) throw new Error("The file was inserted but could not be read back");
  return row;
}

/** How many photos and clips this account has added from its own device: what the upload cap counts. */
export async function countUploads(userId: string, kinds: readonly MediaKind[] = LIBRARY_KINDS): Promise<number> {
  const { rows } = await db().execute<{ n: string }>(sql`
    select count(*) as n from media where user_id = ${userId} and kind = any(${kindList(kinds)}) and ${UPLOADED}
  `);
  return Number(rows[0]?.n ?? 0);
}

export async function getMedia(userId: string, mediaId: string): Promise<Media | null> {
  if (!isUuid(mediaId)) return null;
  const [row] = await db()
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.id, mediaId), eq(schema.media.userId, userId)))
    .limit(1);
  return row ?? null;
}

export type ListMediaOptions = {
  avatarId?: string;
  /** With `avatarId`: rows that carry no avatar at all count as hers too. Every
      row written today has one; this keeps anything older on the shelf. */
  orUnassigned?: boolean;
  limit?: number;
  /**
   * Which folder. Absent means every folder; `null` means only items that
   * are not in one; an id means only that folder's.
   */
  folder?: string | null;
  /** Leave out takes the judge rejected (`meta.keep === false`). The shelves always do. */
  keptOnly?: boolean;
  /** Only rows with the heart on (`meta.favorite`), for the Favorites tab. */
  favoritesOnly?: boolean;
  /** Leave out setup photos she has replaced (`meta.retired`): they no longer count or show in setup. */
  liveOnly?: boolean;
};

export async function listMedia(userId: string, kind: MediaKind, options: ListMediaOptions = {}): Promise<Media[]> {
  const where = and(
    eq(schema.media.userId, userId),
    eq(schema.media.kind, kind),
    options.avatarId
      ? options.orUnassigned
        ? or(eq(schema.media.avatarId, options.avatarId), isNull(schema.media.avatarId))
        : eq(schema.media.avatarId, options.avatarId)
      : undefined,
    options.folder === undefined
      ? undefined
      : options.folder === null
        ? isNull(schema.media.folderId)
        : eq(schema.media.folderId, options.folder),
    options.keptOnly ? sql`coalesce(${schema.media.meta}->>'keep', 'true') <> 'false'` : undefined,
    options.favoritesOnly ? sql`${schema.media.meta}->>'favorite' = 'true'` : undefined,
    options.liveOnly ? sql`coalesce(${schema.media.meta}->>'retired', 'false') <> 'true'` : undefined,
  );
  return db().select().from(schema.media).where(where).orderBy(desc(schema.media.createdAt)).limit(options.limit ?? 200);
}

/**
 * Every photo and clip this account added from its own device, on every
 * avatar, newest first: the Uploads tab, which then groups and filters them.
 * The same rows the upload cap counts.
 */
export async function listUploads(userId: string): Promise<Media[]> {
  return db()
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.userId, userId), sql`${schema.media.kind} = any(${kindList(["image", "clip"])})`, UPLOADED))
    .orderBy(desc(schema.media.createdAt))
    .limit(SHOW_ALL);
}

/** This user's rows among `ids`, in the order asked; foreign and unknown ids are left out. */
export async function getManyMedia(userId: string, ids: string[]): Promise<Media[]> {
  const valid = [...new Set(ids.filter(isUuid))].slice(0, MAX_BATCH);
  if (valid.length === 0) return [];
  const rows = await db()
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.userId, userId), inArray(schema.media.id, valid)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return valid.map((id) => byId.get(id)).filter((row): row is Media => row !== undefined);
}

/**
 * Which of `roots` (upload ids, see `copyRoot` in src/lib/uploads.ts) this
 * avatar already holds, as the upload itself or as a copy of it. What keeps a
 * second press from copying twice.
 */
export async function copyRootsOnAvatar(userId: string, avatarId: string, roots: string[]): Promise<Set<string>> {
  const valid = [...new Set(roots.filter(isUuid))];
  if (valid.length === 0 || !isUuid(avatarId)) return new Set();
  const list = sql`array[${sql.join(valid.map((id) => sql`${id}`), sql`, `)}]::text[]`;
  const rows = await db()
    .select({ id: schema.media.id, from: sql<string | null>`${schema.media.meta}->>'copiedFrom'` })
    .from(schema.media)
    .where(
      and(
        eq(schema.media.userId, userId),
        eq(schema.media.avatarId, avatarId),
        or(inArray(schema.media.id, valid), sql`${schema.media.meta}->>'copiedFrom' = any(${list})`),
      ),
    );
  const wanted = new Set(valid);
  const found = new Set<string>();
  for (const row of rows) {
    if (wanted.has(row.id)) found.add(row.id);
    if (row.from && wanted.has(row.from)) found.add(row.from);
  }
  return found;
}

/**
 * A copy of one of her uploads for another avatar. The bytes are read and
 * stored again under a new id, so the two rows never share an object and
 * deleting either leaves the other whole. Counted against the upload cap like
 * any upload, since it takes the same room: `MediaLimitReachedError` when
 * full. The caller has already checked that the avatar is this user's.
 */
export async function copyMediaToAvatar(userId: string, source: Media, avatarId: string, meta: Record<string, unknown>): Promise<Media> {
  if (source.userId !== userId) throw new Error("Media not found");
  const { stream } = await getStorage().get(source.pathname);
  return saveMediaCappedAcross(userId, {
    kind: source.kind,
    data: await readAll(stream),
    contentType: source.contentType,
    avatarId,
    // A folder is one avatar's shoot; the copy starts unfiled on hers.
    folderId: null,
    width: source.width,
    height: source.height,
    durationSeconds: source.durationSeconds == null ? null : Number(source.durationSeconds),
    meta,
  });
}

/** The most one move or delete may touch at once. A screen of tiles, not a script. */
export const MAX_BATCH = 100;

/**
 * File `ids` under `folderId` (null: take them out of their folder). Only this
 * user's library items move; ids that are not theirs, or are not library
 * kinds, are simply not matched. The folder itself must be theirs too, which
 * the caller checks with `requireOwnFolder` before getting here. Returns how
 * many rows moved.
 */
export async function moveMedia(userId: string, ids: string[], folderId: string | null): Promise<number> {
  const valid = ids.filter(isUuid).slice(0, MAX_BATCH);
  if (valid.length === 0) return 0;
  const rows = await db()
    .update(schema.media)
    .set({ folderId })
    .where(and(eq(schema.media.userId, userId), inArray(schema.media.id, valid), inArray(schema.media.kind, [...LIBRARY_KINDS])))
    .returning({ id: schema.media.id });
  return rows.length;
}

/** Looks up a row this user imported from a given local file, so the import is idempotent. */
export async function mediaBySource(userId: string, source: string): Promise<Media | null> {
  const [row] = await db()
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.userId, userId), sql`${schema.media.meta}->>'source' = ${source}`))
    .limit(1);
  return row ?? null;
}

/**
 * The file this user already added under this request id, so a repeated
 * delivery of one upload returns the first row instead of storing a second.
 * Scoped to the user: another account's request id finds nothing.
 */
export async function uploadByRequest(userId: string, requestId: string): Promise<Media | null> {
  if (!requestId) return null;
  const [row] = await db()
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.userId, userId), UPLOADED, sql`${schema.media.meta}->>'requestId' = ${requestId}`))
    .orderBy(asc(schema.media.createdAt))
    .limit(1);
  return row ?? null;
}

export async function updateMediaMeta(userId: string, mediaId: string, patch: Record<string, unknown>): Promise<Media | null> {
  if (!isUuid(mediaId)) return null;
  const [row] = await db()
    .update(schema.media)
    .set({ meta: sql`${schema.media.meta} || ${JSON.stringify(patch)}::jsonb` })
    .where(and(eq(schema.media.id, mediaId), eq(schema.media.userId, userId)))
    .returning();
  return row ?? null;
}

/** Marks every setup photo of one avatar as replaced, or takes the mark off
    again. Only her own rows: both filters are on the owner. Returns how many
    rows changed. */
export async function setSetupPhotosRetired(userId: string, avatarId: string, retired: boolean): Promise<number> {
  if (!isUuid(avatarId)) return 0;
  const rows = await db()
    .update(schema.media)
    .set({ meta: sql`${schema.media.meta} || ${JSON.stringify({ retired })}::jsonb` })
    .where(and(eq(schema.media.userId, userId), eq(schema.media.avatarId, avatarId), eq(schema.media.kind, "upload")))
    .returning({ id: schema.media.id });
  return rows.length;
}

export async function deleteMedia(userId: string, mediaId: string): Promise<boolean> {
  const row = await getMedia(userId, mediaId);
  if (!row) return false;
  /* A reel is a draft's finished file. Taking the file away leaves the hook,
     but a hook with no reel is not planned and not ready, so the draft goes
     back to written. The foreign key alone would only blank the reference and
     leave a "ready" post with nothing to download. A
     re-assembly deletes the previous reel after the draft already points at
     the new one, so this matches nothing in that case, by design. */
  if (row.kind === "reel") {
    const reset = await db()
      .update(schema.drafts)
      .set({ status: "draft", outputMediaId: null, updatedAt: new Date() })
      .where(and(eq(schema.drafts.userId, userId), eq(schema.drafts.outputMediaId, mediaId)))
      .returning({ avatarId: schema.drafts.avatarId, hook: schema.drafts.hook });
    /* The draft now has no reel, so no page lists it; its words go to Hooks
       (once: words already saved there are left alone) so the reel can be
       made again on another clip. */
    const words = reset.map((draft) => ({ userId, avatarId: draft.avatarId, text: cleanHookText(draft.hook) })).filter((hook) => hook.text);
    if (words.length) await db().insert(schema.hooks).values(words).onConflictDoNothing();
  }
  await db().delete(schema.media).where(and(eq(schema.media.id, mediaId), eq(schema.media.userId, userId)));
  await getStorage().delete(row.pathname);
  return true;
}

/** Deletes each of `ids` this user owns, one at a time so a failure mid-way leaves the rest intact. Returns how many went. */
export async function deleteManyMedia(userId: string, ids: string[]): Promise<number> {
  let gone = 0;
  for (const id of ids.filter(isUuid).slice(0, MAX_BATCH)) {
    if (await deleteMedia(userId, id)) gone += 1;
  }
  return gone;
}

/**
 * Whether a row may be used for this avatar: hers, or from before rows carried
 * an avatar at all (the same rule as `orUnassigned`). Every photo or clip that
 * goes into one avatar's work passes this; one avatar's face in another's
 * carousel or reel is the failure it prevents.
 */
export function ofAvatar(row: { avatarId: string | null }, avatarId: string | null | undefined): boolean {
  return !row.avatarId || row.avatarId === avatarId;
}

/** Where every stored object of one avatar lives: what deleting her has to remove from storage. */
export async function avatarPathnames(userId: string, avatarId: string): Promise<string[]> {
  const rows = await db()
    .select({ pathname: schema.media.pathname })
    .from(schema.media)
    .where(and(eq(schema.media.userId, userId), eq(schema.media.avatarId, avatarId)));
  return rows.map((row) => row.pathname);
}

/** How many of each kind one avatar holds, for saying what deleting her deletes. */
export async function avatarMediaCounts(userId: string, avatarId: string): Promise<Partial<Record<MediaKind, number>>> {
  const rows = await db()
    .select({ kind: schema.media.kind, n: sql<number>`count(*)::int` })
    .from(schema.media)
    .where(and(eq(schema.media.userId, userId), eq(schema.media.avatarId, avatarId)))
    .groupBy(schema.media.kind);
  return Object.fromEntries(rows.map((row) => [row.kind, Number(row.n)]));
}

/** Everything one user owns, for account deletion. */
export async function deleteAllMedia(userId: string): Promise<void> {
  await db().delete(schema.media).where(eq(schema.media.userId, userId));
  await getStorage().deletePrefix(userPrefix(userId));
}

export async function readMedia(userId: string, mediaId: string): Promise<Buffer> {
  const row = await getMedia(userId, mediaId);
  if (!row) throw new Error("Media not found");
  const { stream } = await getStorage().get(row.pathname);
  return readAll(stream);
}

/* Generation still works in files: ffmpeg reads a path, Higgsfield uploads one.
   This hands those modules a real file and takes it away again, so nothing
   downloaded for one user is left on disk for the next request to find. */
export async function withLocalFile<T>(userId: string, mediaId: string, fn: (path: string) => Promise<T>): Promise<T> {
  const row = await getMedia(userId, mediaId);
  if (!row) throw new Error("Media not found");
  const dir = await mkdtemp(join(tmpdir(), "media-"));
  try {
    // The temp directory is made at runtime; tracing it would pull the whole project into the bundle.
    const path = join(/* turbopackIgnore: true */ dir, `${row.id}.${extensionFor(row.contentType)}`);
    const { stream } = await getStorage().get(row.pathname);
    await writeFile(path, await readAll(stream));
    return await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
