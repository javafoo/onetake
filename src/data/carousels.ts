import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

import type { FaceBox, TextLook } from "@/carousel/render";
import { normalizeHex } from "@/content/keyword-color";
import { normalizeTextSize } from "@/content/text-styles";
import { carouselSpecSchema, type CarouselSpec, type Format } from "@/carousel/spec";
import type { Palette } from "@/carousel/kits";
import { photoSubject, type PhotoSubject } from "@/carousel/match";
import { db, schema } from "@/db/client";
import { isFavorite } from "@/lib/tile-actions";

import { getAvatar } from "./avatars";
import type { Draft } from "./drafts";
import { isUuid } from "./ids";
import type { Media } from "./media";

/* Carousels and story sequences, as rows.

   A set is one `drafts` row (format "carousel" or "story") plus one `media` row
   of kind "slide" per PNG. Nothing new was added to the schema for it:

   - `drafts.spec` holds the CarouselSpec the writer produced, with three extra
     keys beside it — the kit, any palette the creator retuned, and which photo
     each reference resolves to. The engine's own `carouselSpecSchema.parse`
     reads the row and drops those three, so the column is still exactly what
     `src/db/schema.ts` says it is: a CarouselSpec. They are render settings,
     not writing, and they have to survive so one slide can be redrawn later
     without asking the model anything.
   - a slide's place in the set is `media.meta.index`, and the set it belongs to
     is `media.meta.draftId`.
   - `drafts.outputMediaId` points at the cover slide, so a carousel has a
     thumbnail everywhere a reel has a poster frame.
   - `drafts.spec.favorite` is the heart on the set's tile. It sits beside the
     spec rather than on a slide because slides are redrawn as new rows, and
     `saveDoc` keeps it across every rewrite of the spec.

   Every function takes `userId` first and filters on it, like the rest of
   `src/data`. */

export type CarouselDoc = CarouselSpec & {
  /** The style kit id. `resolveKit` is what decides whether this account may use it. */
  kit: string;
  /** Colours the creator retuned. The rest of the kit is ours. */
  palette?: Partial<Palette>;
  /** Photo reference ("p00") to the media id it draws. */
  photos: Record<string, string>;
  /** The cover's words were the creator's own, so the checks do not judge their length. */
  fixedCover?: boolean;
} & TextLook;

/** The size, case and keyword colour a set was drawn with, so a redrawn slide matches the rest. Older sets have none: large, as typed, the kit's colours. */
export function lookOf(doc: CarouselDoc): TextLook {
  const keywordColor = normalizeHex(doc.keywordColor);
  return { size: normalizeTextSize(doc.size), ...(doc.lowercase === true ? { lowercase: true } : {}), ...(keywordColor ? { keywordColor } : {}) };
}

export type SlideMedia = Media & { index: number };

export type Carousel = {
  draft: Draft;
  doc: CarouselDoc | null;
  slides: SlideMedia[];
};

export type CarouselSummary = {
  draft: Draft;
  kitId: string | null;
  slideCount: number;
  coverMediaId: string | null;
  favorite: boolean;
};

/** The formats this module deals in. A reel draft is not a carousel. */
const SET_FORMATS = ["carousel", "story"] as const;

function isSetFormat(format: Draft["format"]): format is Format {
  return (SET_FORMATS as readonly string[]).includes(format);
}

/** The spec plus its render settings, or null while the job is still working. */
export function readDoc(draft: Draft): CarouselDoc | null {
  const raw = draft.spec as (Record<string, unknown> & { kit?: unknown; palette?: unknown; photos?: unknown }) | null;
  if (!raw) return null;
  const parsed = carouselSpecSchema.safeParse(raw);
  if (!parsed.success) return null;
  const keywordColor = normalizeHex(raw.keywordColor);
  return {
    ...parsed.data,
    kit: typeof raw.kit === "string" ? raw.kit : "signal",
    palette: (raw.palette as Partial<Palette> | undefined) ?? undefined,
    photos: (raw.photos as Record<string, string> | undefined) ?? {},
    fixedCover: raw.fixedCover === true,
    size: normalizeTextSize(raw.size),
    ...(raw.lowercase === true ? { lowercase: true } : {}),
    ...(keywordColor ? { keywordColor } : {}),
  };
}

export async function listCarousels(
  userId: string,
  options: { limit?: number; avatarId?: string; /** Only hearted sets, for the Favorites tab. */ favoritesOnly?: boolean; /** One format only: the Carousels tab shows carousels, the Stories tab the tall ones. */ format?: Format } = {},
): Promise<CarouselSummary[]> {
  const drafts = await db()
    .select()
    .from(schema.drafts)
    .where(
      and(
        eq(schema.drafts.userId, userId),
        options.avatarId ? eq(schema.drafts.avatarId, options.avatarId) : undefined,
        options.format ? eq(schema.drafts.format, options.format) : sql`${schema.drafts.format} in ('carousel', 'story')`,
        options.favoritesOnly ? sql`${schema.drafts.spec}->>'favorite' = 'true'` : undefined,
      ),
    )
    .orderBy(desc(schema.drafts.createdAt))
    .limit(options.limit ?? 100);

  const counts = await db()
    .select({ draftId: sql<string>`${schema.media.meta}->>'draftId'`, count: sql<number>`count(*)::int` })
    .from(schema.media)
    .where(and(eq(schema.media.userId, userId), eq(schema.media.kind, "slide")))
    .groupBy(sql`${schema.media.meta}->>'draftId'`);
  const byDraft = new Map(counts.map((row) => [row.draftId, row.count]));

  return drafts.map((draft) => {
    const doc = readDoc(draft);
    return {
      draft,
      kitId: doc?.kit ?? null,
      slideCount: byDraft.get(draft.id) ?? 0,
      coverMediaId: draft.outputMediaId,
      favorite: isFavorite(draft.spec),
    };
  });
}

/** Slide rows for one set, in the order they are swiped. */
export async function listSlides(userId: string, draftId: string): Promise<SlideMedia[]> {
  if (!isUuid(draftId)) return [];
  const rows = await db()
    .select()
    .from(schema.media)
    .where(
      and(
        eq(schema.media.userId, userId),
        eq(schema.media.kind, "slide"),
        sql`${schema.media.meta}->>'draftId' = ${draftId}`,
      ),
    );
  return rows
    .map((row) => ({ ...row, index: Number((row.meta as { index?: number }).index ?? 0) }))
    .sort((a, b) => a.index - b.index);
}

export async function getCarousel(userId: string, draftId: string): Promise<Carousel | null> {
  if (!isUuid(draftId)) return null;
  const [draft] = await db()
    .select()
    .from(schema.drafts)
    .where(and(eq(schema.drafts.id, draftId), eq(schema.drafts.userId, userId)))
    .limit(1);
  if (!draft || !isSetFormat(draft.format)) return null;
  return { draft, doc: readDoc(draft), slides: await listSlides(userId, draft.id) };
}

/**
 * The empty set, written before the job starts.
 *
 * The row exists first so the creator has somewhere to be sent while the
 * writing and the rendering happen: `/carousels/<id>` is a real page from the
 * moment she presses the button, and the job fills it in.
 */
export async function createCarouselDraft(
  userId: string,
  avatarId: string,
  input: { topic: string; format: Format; skeleton: string },
): Promise<Draft> {
  if (!(await getAvatar(userId, avatarId))) throw new Error("Avatar not found");
  const [row] = await db()
    .insert(schema.drafts)
    .values({
      userId,
      avatarId,
      format: input.format,
      hook: input.topic,
      angle: input.skeleton,
      status: "draft",
    })
    .returning();
  return row;
}

/**
 * Store the spec and its render settings back on the draft. The favorite
 * flag is read from the row as it is now, not from `doc`: `readDoc` drops it,
 * and an edit or a redraw must not unfavorite the set.
 */
export async function saveDoc(userId: string, draftId: string, doc: CarouselDoc): Promise<void> {
  if (!isUuid(draftId)) throw new Error("Draft not found");
  const rows = await db()
    .update(schema.drafts)
    .set({
      spec: sql`${JSON.stringify(doc)}::jsonb || jsonb_strip_nulls(jsonb_build_object('favorite', ${schema.drafts.spec}->'favorite'))`,
      caption: doc.caption,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.drafts.id, draftId), eq(schema.drafts.userId, userId)))
    .returning({ id: schema.drafts.id });
  if (!rows.length) throw new Error("Draft not found");
}

/**
 * Hearts a set or takes the heart off. A set still being made has no spec
 * yet; the flag alone is written, and `saveDoc` keeps it when the spec lands.
 * Returns false when the set is not this user's.
 */
export async function setSetFavorite(userId: string, draftId: string, on: boolean): Promise<boolean> {
  if (!isUuid(draftId)) return false;
  const rows = await db()
    .update(schema.drafts)
    .set({
      spec: on
        ? sql`coalesce(${schema.drafts.spec}, '{}'::jsonb) || '{"favorite":true}'::jsonb`
        : sql`${schema.drafts.spec} - 'favorite'`,
    })
    .where(
      and(
        eq(schema.drafts.id, draftId),
        eq(schema.drafts.userId, userId),
        sql`${schema.drafts.format} in ('carousel', 'story')`,
      ),
    )
    .returning({ id: schema.drafts.id });
  return rows.length > 0;
}

/** The sets this user has a job still working on, for the list page's one query. */
export async function draftsWithPendingJob(userId: string): Promise<Set<string>> {
  const rows = await db()
    .select({ draftId: sql<string | null>`${schema.jobs.input}->>'draftId'` })
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.userId, userId),
        eq(schema.jobs.kind, "carousel"),
        sql`${schema.jobs.status} in ('queued', 'running')`,
      ),
    );
  return new Set(rows.map((row) => row.draftId).filter((id): id is string => Boolean(id)));
}

/** The job that is writing or rendering this set, if one still is. */
export async function pendingJob(userId: string, draftId: string): Promise<{ id: string; status: string } | null> {
  if (!isUuid(draftId)) return null;
  const [row] = await db()
    .select({ id: schema.jobs.id, status: schema.jobs.status })
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.userId, userId),
        eq(schema.jobs.kind, "carousel"),
        sql`${schema.jobs.input}->>'draftId' = ${draftId}`,
      ),
    )
    .orderBy(desc(schema.jobs.createdAt))
    .limit(1);
  if (!row) return null;
  return row.status === "queued" || row.status === "running" ? row : null;
}

/* --- photos ------------------------------------------------------------- */

export type PhotoOption = {
  id: string;
  /** "image" is a photo she generated, "reference" an original she uploaded. */
  kind: "image" | "reference";
  createdAt: number;
  /** Cached in `media.meta` the first time a set uses the photo. */
  faceBox: FaceBox | null | undefined;
  /** "scene" for an upload she marked as a place or a thing rather than herself. */
  subject: PhotoSubject;
};

/**
 * Everything a set for this avatar may be built from: her photos, and her
 * reference originals. Scoped to the avatar, not the account: a set made
 * under one avatar once picked another avatar's photos. A take the judge
 * rejected (`meta.keep === false`) is left out, the same way the Library page
 * leaves it out.
 */
export async function photoOptions(userId: string, avatarId: string): Promise<PhotoOption[]> {
  const rows = await db()
    .select()
    .from(schema.media)
    .where(
      and(
        eq(schema.media.userId, userId),
        sql`${schema.media.kind} in ('image', 'reference')`,
        // Rows from before media carried an avatar count as hers, as on every other shelf.
        or(eq(schema.media.avatarId, avatarId), isNull(schema.media.avatarId)),
      ),
    )
    .orderBy(desc(schema.media.createdAt))
    .limit(200);

  return rows
    /* A photo that already has words drawn on it would carry two sets of
       words once a slide's own went on top, so it is left out of sets. */
    .filter((row) => (row.meta as { keep?: boolean }).keep !== false && !(row.meta as { words?: unknown }).words)
    .map((row) => ({
      id: row.id,
      kind: row.kind === "reference" ? ("reference" as const) : ("image" as const),
      createdAt: row.createdAt.getTime(),
      faceBox: (row.meta as { faceBox?: FaceBox | null }).faceBox,
      subject: photoSubject(row.meta),
    }));
}
