"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";

import { checkSpec } from "@/carousel/check";
import { editCaption, editSlide, setSlidePhoto, titleLinesFrom } from "@/carousel/edit";
import { detectFaceBox } from "@/carousel/faces";
import { kitIds, resolveKit, type Palette, type PaletteKey } from "@/carousel/kits";
import { kitOwnerSlug } from "@/carousel/owners";
import { autoPickPhotos, photoPool } from "@/carousel/pick";
import { renderSlideAt, type FaceBox, type Photos } from "@/carousel/render";
import { FORMATS, layoutFrom, slidePhotos, type Format } from "@/carousel/spec";
import { SKELETON_IDS, type Skeleton } from "@/carousel/write";
import { photoShelf } from "@/components/library/shelves";
import { briefForOffer, offerIndexOfKeyword, withOffer } from "@/content/offers";
import { getBrief, getProfile, profileComplete } from "@/data/brand";
import {
  createCarouselDraft,
  getCarousel,
  listSlides,
  lookOf,
  pendingJob,
  photoOptions,
  saveDoc,
  setSetFavorite,
  type CarouselDoc,
} from "@/data/carousels";
import { deleteDraft, updateDraft } from "@/data/drafts";
import { deleteMedia, getMedia, ofAvatar, readMedia, saveMedia, updateMediaMeta, withLocalFile } from "@/data/media";
import { requireUser, type User } from "@/data/users";
import { startJob } from "@/jobs";
import { guardedAction } from "@/lib/action-guard";
import { currentAvatar } from "@/lib/current-avatar";
import { withModelSpend } from "@/spend";
import { InvalidRequestError, userMessage } from "@/lib/errors";

/* Everything /carousels can do.
 *
 * Two kinds of work live here and they are priced differently on purpose:
 *
 * - Making a set writes with a model, so it is a job (`startJob`), it needs an
 *   active plan, and it is idempotent on the browser's `requestId`. It costs
 *   zero credits: writing and drawing are in the plan.
 * - Changing a set afterwards — the words on a slide, its photo, the caption —
 *   calls no model at all. It redraws one canvas and returns. That is free in
 *   every sense, and it deliberately does not ask for `requireCanGenerate`: a
 *   card that failed should cost someone their new work, not their old work.
 *
 * A server action is a public endpoint, so every one of these re-checks the
 * session and looks every id up scoped to its owner.
 */

/** Same shape as the rest of the app's actions, so `<ActionForm>` works unchanged. */
export type ActionState = { ok: boolean; message: string; jobId?: string } | null;

type Outcome = string | { message: string; jobId?: string };

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const number = (form: FormData, key: string) => Number.parseInt(text(form, key), 10);

/* The session check, the per-account retry guard and the error taxonomy live
   in `@/lib/action-guard`; this is only the shape these actions hand back. */
function guarded(where: string, form: FormData, run: (user: User, requestId: string) => Promise<Outcome>): Promise<ActionState> {
  return guardedAction<Outcome, ActionState>(form, {
    where,
    run,
    done: (outcome) => (typeof outcome === "string" ? { ok: true, message: outcome } : { ok: true, ...outcome }),
    failed: (message) => ({ ok: false, message }),
  });
}

/* --- making a set -------------------------------------------------------- */

const PALETTE_KEYS: PaletteKey[] = ["paper", "panel", "ink", "accent", "muted", "contrast"];

/** Only #rrggbb, only keys the kit has. Anything else is simply not an override. */
function paletteFrom(form: FormData): Partial<Palette> | undefined {
  const palette: Partial<Palette> = {};
  for (const key of PALETTE_KEYS) {
    const value = text(form, `palette.${key}`);
    if (/^#[0-9a-fA-F]{6}$/.test(value)) palette[key] = value.toLowerCase();
  }
  return Object.keys(palette).length ? palette : undefined;
}

export async function createCarouselAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded("createCarouselAction", form, async (user, requestId) => {
    const topic = text(form, "topic");
    if (topic.length < 8) throw new InvalidRequestError("Say what the set is about, in one line.");
    if (topic.length > 240) throw new InvalidRequestError("Keep the topic to one line.");

    const format: Format = text(form, "format") === "story" ? "story" : "carousel";
    const layout = layoutFrom(text(form, "layout"));
    const skeleton = text(form, "skeleton") as Skeleton;
    if (!SKELETON_IDS.includes(skeleton)) throw new InvalidRequestError("Pick a shape for the set.");

    // The kit list is rebuilt here rather than trusted: a private kit must not
    // be reachable by typing its id into the form.
    const kit = text(form, "kit");
    if (!kitIds(kitOwnerSlug(user.id)).includes(kit)) throw new InvalidRequestError("Pick a look.");

    const avatar = await currentAvatar(user.id);
    const profile = await getProfile(user.id, avatar?.id ?? null);
    if (!avatar || !profileComplete(profile)) {
      throw new InvalidRequestError("Fill in the Brand page first: niche, audience, offer and keyword.");
    }

    const chosen = form.getAll("photos").map(String).filter(Boolean);
    const owned: string[] = [];
    for (const id of chosen) {
      const row = await getMedia(user.id, id);
      /* Hers, and this avatar's: a photo of another avatar never goes into this
         one's set. A quote photo already has words, so a slide's would go on top. */
      if (row && (row.kind === "image" || row.kind === "reference") && ofAvatar(row, avatar.id) && photoShelf(row.meta) !== "words") owned.push(row.id);
    }
    // No choice is a choice: pick for her rather than stopping the flow.
    const photoMediaIds = owned.length ? owned : autoPickPhotos(await photoOptions(user.id, avatar.id), photoPool(format, layout), layout);
    if (!photoMediaIds.length) {
      throw new InvalidRequestError("There are no photos to build a cover from. Add one on the Library page first.");
    }

    const draft = await createCarouselDraft(user.id, avatar.id, { topic, format, skeleton });
    try {
      await startJob(user, {
        kind: "carousel",
        avatarId: avatar.id,
        requestId,
        input: {
          kind: "carousel",
          draftId: draft.id,
          format,
          topic,
          skeleton,
          layout,
          kit,
          palette: paletteFrom(form),
          photoMediaIds,
          slides: Number.isFinite(number(form, "slides")) ? number(form, "slides") : undefined,
          // "off" writes the set without her brand; anything else, or nothing, is on.
          ...(text(form, "brand") === "off" ? { brand: false } : {}),
        },
      });
    } catch (error) {
      // Nothing ran, so leave no half-made set in her list.
      await deleteDraft(user.id, draft.id);
      throw error;
    }

    revalidatePath("/carousels");
    // She watches it being made on the set's own page, which already exists.
    redirect(`/carousels/${draft.id}`);
  });
}

/* --- changing a set afterwards ------------------------------------------- */

/** The set, its kit and the photos it draws, ready to redraw one slide. */
async function loaded(user: User, draftId: string) {
  const carousel = await getCarousel(user.id, draftId);
  if (!carousel?.doc) throw new InvalidRequestError("That set is not finished yet.");
  const kit = resolveKit(carousel.doc.kit, { palette: carousel.doc.palette, profileSlug: kitOwnerSlug(user.id) });
  return { ...carousel, doc: carousel.doc, kit };
}

/** Where the face sits: asked once per photo, then kept on the photo's own row. */
async function faceBoxFor(user: User, mediaId: string): Promise<FaceBox | null> {
  const row = await getMedia(user.id, mediaId);
  if (!row) throw new InvalidRequestError("That photo is not in your library.");
  const cached = (row.meta as { faceBox?: FaceBox | null }).faceBox;
  if (cached !== undefined) return cached;
  /* A vision call, and a cache miss is a model call: swapping a slide's photo
     back and forth between two photos it has already seen is free, but a
     library full of fresh ones is not. */
  const box = await withModelSpend(user, { limit: "vision", shape: "find_face" }, () =>
    withLocalFile(user.id, mediaId, (path) => detectFaceBox(path)));
  await updateMediaMeta(user.id, mediaId, { faceBox: box });
  return box;
}

/**
 * Redraw exactly one slide.
 *
 * The new picture is a new media row with a new id, and the old row is deleted
 * once the draft no longer points at it. Overwriting the old row in place would
 * be tidier to read, but blob storage takes a moment to settle after a write to
 * a path it already holds, and the browser would be asking for that exact path
 * within milliseconds: the first version of this put the new bytes under the
 * old id and the redrawn slide came back as a broken image until a reload. A
 * new id means a new URL, so there is nothing stale to serve and nothing to
 * bust a cache with.
 */
async function redrawSlide(
  user: User,
  set: Awaited<ReturnType<typeof loaded>>,
  doc: CarouselDoc,
  index: number,
): Promise<void> {
  const slide = doc.slides[index];
  const photos: Photos = {};
  for (const ref of slidePhotos(slide)) {
    if (photos[ref]) continue;
    const mediaId = doc.photos[ref];
    if (!mediaId) throw new InvalidRequestError("This slide points at a photo that is no longer in the set.");
    photos[ref] = { data: await readMedia(user.id, mediaId), face: await faceBoxFor(user, mediaId) };
  }

  const png = await renderSlideAt(doc, set.kit, photos, index, lookOf(doc));
  const frame = FORMATS[doc.format];
  const drawn = await saveMedia(user.id, {
    kind: "slide",
    data: png,
    contentType: "image/png",
    avatarId: set.draft.avatarId,
    width: frame.width,
    height: frame.height,
    meta: { draftId: set.draft.id, index, renderedAt: Date.now() },
  });

  // The cover is also the thumbnail everywhere else, so it moves with the slide.
  if (index === 0) await updateDraft(user.id, set.draft.id, { outputMediaId: drawn.id });
  const previous = set.slides.find((row) => row.index === index);
  if (previous) await deleteMedia(user.id, previous.id);
}

export async function editSlideAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded("editSlideAction", form, async (user) => {
    const index = number(form, "index");
    const set = await loaded(user, text(form, "id"));
    if (!Number.isInteger(index) || !set.doc.slides[index]) throw new InvalidRequestError("That slide is not in this set.");

    const raw = form.get("titleLines");
    const edited = editSlide(set.doc, index, {
      titleLines: raw === null ? undefined : titleLinesFrom(String(raw)),
      accent: form.get("accent") === null ? undefined : text(form, "accent"),
      sub: form.get("sub") === null ? undefined : text(form, "sub"),
      body: form.get("body") === null ? undefined : text(form, "body"),
      keyword: form.get("keyword") === null ? undefined : text(form, "keyword").toUpperCase(),
      promise: form.get("promise") === null ? undefined : text(form, "promise"),
      top: form.get("top") === null ? undefined : text(form, "top"),
      bottom: form.get("bottom") === null ? undefined : text(form, "bottom"),
      text: form.get("text") === null ? undefined : text(form, "text"),
      headline: form.get("headline") === null ? undefined : text(form, "headline"),
    });

    const doc: CarouselDoc = { ...edited, kit: set.doc.kit, palette: set.doc.palette, photos: set.doc.photos, fixedCover: set.doc.fixedCover, ...lookOf(set.doc) };
    await redrawSlide(user, set, doc, index);
    await saveDoc(user.id, set.draft.id, doc);

    // The same checks the writer had to pass, run again over what she typed.
    const avatar = await currentAvatar(user.id);
    const [profile, brief] = await Promise.all([
      getProfile(user.id, avatar?.id ?? null),
      getBrief(user.id, avatar?.id ?? null),
    ]);
    // Checked against the offer the set sells: her keyword on its last slide says which.
    const last = doc.slides[doc.slides.length - 1];
    const offer = last?.type === "keyword" ? offerIndexOfKeyword(profile, last.keyword) : -1;
    const failing = checkSpec(doc, { profile: withOffer(profile, offer), brief: briefForOffer(brief, profile, offer), topic: set.draft.hook, fixedCover: doc.fixedCover }).length;

    revalidatePath(`/carousels/${set.draft.id}`);
    revalidatePath("/carousels");
    return failing
      ? `Slide ${index + 1} redrawn. ${failing === 1 ? "One rule still fails" : `${failing} rules still fail`}.`
      : `Slide ${index + 1} redrawn. Every check passes.`;
  });
}

export async function swapPhotoAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded("swapPhotoAction", form, async (user) => {
    const index = number(form, "index");
    const set = await loaded(user, text(form, "id"));
    const slide = set.doc.slides[index];
    if (!slide) throw new InvalidRequestError("That slide is not in this set.");
    if (slide.type === "paper") throw new InvalidRequestError("This slide has no photo on it.");

    const photo = await getMedia(user.id, text(form, "photo"));
    if (!photo || (photo.kind !== "image" && photo.kind !== "reference") || !ofAvatar(photo, set.draft.avatarId)) {
      throw new InvalidRequestError("Pick a photo of this avatar from your library.");
    }
    if (photoShelf(photo.meta) === "words") throw new InvalidRequestError("That photo already has words on it. Pick one without words.");

    /* Each photo on each slide gets its own reference, so changing slide
       four's photo can never quietly change slide one's, nor the other half
       of the same slide. */
    const slot = form.get("slot") === null ? 0 : number(form, "slot");
    const ref = `s${String(index).padStart(2, "0")}${slot ? `-${slot}` : ""}`;
    let spec;
    try {
      spec = setSlidePhoto(set.doc, index, ref, slot);
    } catch (error) {
      throw new InvalidRequestError(error instanceof Error ? error.message : "That photo is not on this slide.");
    }
    const doc: CarouselDoc = {
      ...spec,
      kit: set.doc.kit,
      palette: set.doc.palette,
      photos: { ...set.doc.photos, [ref]: photo.id },
      fixedCover: set.doc.fixedCover,
      ...lookOf(set.doc),
    };

    await redrawSlide(user, set, doc, index);
    await saveDoc(user.id, set.draft.id, doc);

    revalidatePath(`/carousels/${set.draft.id}`);
    revalidatePath("/carousels");
    return `Slide ${index + 1} has the new photo.`;
  });
}

export async function editCaptionAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded("editCaptionAction", form, async (user) => {
    const set = await loaded(user, text(form, "id"));
    const caption = text(form, "caption");
    if (!caption) throw new InvalidRequestError("Write the caption, or leave the old one.");
    const doc: CarouselDoc = {
      ...editCaption(set.doc, caption),
      kit: set.doc.kit,
      palette: set.doc.palette,
      photos: set.doc.photos,
      fixedCover: set.doc.fixedCover,
      ...lookOf(set.doc),
    };
    await saveDoc(user.id, set.draft.id, doc);
    revalidatePath(`/carousels/${set.draft.id}`);
    return "Caption saved.";
  });
}

/** The set and every slide of it, for good. Looked up as hers first. */
async function removeSet(userId: string, draftId: string): Promise<void> {
  const set = await getCarousel(userId, draftId);
  if (!set) throw new InvalidRequestError("That set is gone.");
  // The slides first: a draft row that is gone cannot tell us which they were.
  const slides = await listSlides(userId, set.draft.id);
  await updateDraft(userId, set.draft.id, { outputMediaId: null });
  for (const slide of slides) await deleteMedia(userId, slide.id);
  await deleteDraft(userId, set.draft.id);
  revalidatePath("/", "layout");
}

export async function deleteCarouselAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded("deleteCarouselAction", form, async (user) => {
    await removeSet(user.id, text(form, "id"));
    redirect("/carousels");
  });
}

/* --- the corner buttons on a set's tile ----------------------------------- */

/* Called from the tile directly rather than through a form, so they take plain
   arguments. Both are safe to repeat: a heart set twice is set, and a set
   deleted twice is gone. There is no request id to guard, as neither spends. */

async function fromTile(where: string, run: (user: User) => Promise<string>): Promise<{ ok: boolean; message: string }> {
  try {
    const user = await requireUser();
    return { ok: true, message: await run(user) };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: userMessage(where, error) };
  }
}

/** Deletes a set from its tile on /carousels, where there is no page to leave. */
export async function deleteSetAction(draftId: string): Promise<{ ok: boolean; message: string }> {
  return fromTile("deleteSetAction", async (user) => {
    // A job still drawing it would write slides for a set that is gone.
    if (await pendingJob(user.id, String(draftId))) throw new InvalidRequestError("This set is still being made. Delete it once it is done.");
    await removeSet(user.id, String(draftId));
    return "Set deleted.";
  });
}

export async function setSetFavoriteAction(draftId: string, on: boolean): Promise<{ ok: boolean; message: string }> {
  return fromTile("setSetFavoriteAction", async (user) => {
    if (!(await setSetFavorite(user.id, String(draftId), on === true))) throw new InvalidRequestError("That set is gone.");
    // The set leaves or joins the Favorites tab as well as its own grid.
    revalidatePath("/", "layout");
    return on === true ? "Added to favorites." : "Removed from favorites.";
  });
}
