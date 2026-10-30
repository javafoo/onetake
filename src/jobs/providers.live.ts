import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clipPriceUsd, CLIP_ENDPOINT } from "@/ai/clips";
import { downloadOmniClip, forgetOmniClip, omniClipStatus, submitOmniClip } from "@/ai/omni";
import { requireClipAspectRatio, requireMadeClipModel, requireRatioForModel } from "@/content/clip-options";
import { describeProblems } from "@/carousel/check";
import { fitPhotos } from "@/carousel/fit";
import { givenSpec } from "@/carousel/given";
import { detectFaceBox } from "@/carousel/faces";
import { resolveKit, type Palette } from "@/carousel/kits";
import { layoutTakesScenes } from "@/carousel/match";
import { kitOwnerSlug } from "@/carousel/owners";
import { carouselName, photoMap } from "@/carousel/pick";
import { renderSpec, renderTextOnPhoto, type FaceBox, type Photos } from "@/carousel/render";
import { askText, FORMATS, layoutFrom, slidePhotos, type Format } from "@/carousel/spec";
import { SKELETONS, withCoverTitle, writeCarousel, type Skeleton } from "@/carousel/write";
import { clipPrompt } from "@/content/motion";
import { keywordColorOf, keywordMarkOf } from "@/content/keyword-color";
import { contentLanguage } from "@/content/languages";
import { briefForOffer, pickOffer, withKeyword, withOffer } from "@/content/offers";
import { talkingPrompt } from "@/content/motion";
import { liveWriterContext } from "@/content/writer-context";
import { generateSceneTakes } from "@/content/scene";
import { getAvatar, identityLock } from "@/data/avatars";
import { getBrief, getProfile, profileComplete } from "@/data/brand";
import { brandFlag, writerBrief, writerProfile } from "@/content/brand-scope";
import { listSlides, saveDoc, type CarouselDoc } from "@/data/carousels";
import { getDraft, updateDraft } from "@/data/drafts";
import { deleteMedia, getMedia, ofAvatar, readMedia, saveMedia, updateMediaMeta, withLocalFile } from "@/data/media";
import { MAX_LOOKS, MAX_SOURCE_PHOTOS } from "@/agent/plan";
import { toReference } from "@/ai/gemini";
import { referencesFor, type Reference } from "@/identity/references";
import { imageDimensions, sniffImageType, type Dimensions } from "@/lib/image-bytes";
import { requireScreenedPhotos } from "@/safety/gate";
import { carriedFavorite } from "@/lib/tile-actions";
import { normalizeTextSize } from "@/content/text-styles";
import { assembleReel } from "@/reel/assemble";
import { analyseFaceZone } from "@/reel/faces";
import type { FaceZone } from "@/reel/placement";

import type { JobProviders, StepOutcome, SubmittedClip } from "./providers";
import { makeTextPhoto, type TextPhotoDeps } from "./text-photo";
import { clipModelOf, imageAspectOf, imageModelOf, type CarouselJobInput, type ClipJobInput, type ImageJobInput, type JobRecord, type ReelJobInput, type TextPhotoJobInput } from "./types";

/* The real work. This is what used to sit inside the server actions, moved
   behind the JobProviders interface so a request no longer waits for it.

   Every function here takes the job, and therefore the owner, and reads and
   writes only that owner's rows: a media id from the original form has already
   been checked, but these look it up scoped again anyway. */

/**
 * The photos a new one is drawn from. The ids came in on a form, so each is
 * looked up scoped to the owner again: a kept photo of this avatar (or of none),
 * at most three, in the order given. One that is gone is skipped rather than
 * failing a paid job over it; none left at all is an error, because the
 * instruction would then be read against nothing.
 */
async function sourcePhotos(userId: string, avatarId: string, ids: string[] | undefined): Promise<Reference[]> {
  if (!ids?.length) return [];
  const sources: Reference[] = [];
  for (const id of [...new Set(ids)].slice(0, MAX_SOURCE_PHOTOS)) {
    const row = await getMedia(userId, id);
    if (!row || row.kind !== "image" || (row.meta as { keep?: unknown }).keep === false) continue;
    if (row.avatarId && row.avatarId !== avatarId) continue;
    sources.push({ mediaId: row.id, image: await withLocalFile(userId, row.id, (path) => toReference(path)) });
  }
  if (!sources.length) throw new Error("The photos you attached are not in your library any more.");
  return sources;
}

/**
 * The pictures she pasted to recreate. Looked up as hers again, and screened
 * again with the rest, like any photo that reaches a model. One that is gone is
 * skipped: the photo is then made from her words alone, which beats failing a
 * paid job.
 */
async function lookPhotos(userId: string, avatarId: string, ids: string[] | undefined): Promise<Reference[]> {
  if (!ids?.length) return [];
  const looks: Reference[] = [];
  for (const id of [...new Set(ids)].slice(0, MAX_LOOKS)) {
    const row = await getMedia(userId, id);
    if (!row || row.kind !== "image" || (row.avatarId && row.avatarId !== avatarId)) continue;
    looks.push({ mediaId: row.id, image: await withLocalFile(userId, row.id, (path) => toReference(path)) });
  }
  return looks;
}

async function lockedAvatar(job: JobRecord) {
  if (!job.avatarId) throw new Error("This job has no avatar.");
  const avatar = await getAvatar(job.userId, job.avatarId);
  const lock = identityLock(avatar);
  if (!avatar || !lock) throw new Error("Her description is not saved yet. Finish her setup first.");
  return { avatar, lock };
}

export const liveProviders: JobProviders = {
  async generateImage(job, input: ImageJobInput): Promise<StepOutcome> {
    const { avatar, lock } = await lockedAvatar(job);
    const references = await referencesFor(job.userId, avatar.id);

    /* The last check before anything is drawn, and it fails closed: a photo
       with no verdict is screened now, and a check that cannot run stops the
       job rather than letting it through. The verdicts were almost always
       written at upload, so this is normally five reads. */
    await requireScreenedPhotos(job.userId, references);
    const sources = await sourcePhotos(job.userId, avatar.id, input.sourceMediaIds);
    await requireScreenedPhotos(job.userId, sources);
    const looks = await lookPhotos(job.userId, avatar.id, input.lookMediaIds);
    await requireScreenedPhotos(job.userId, looks);

    const { kept, rejected, costUsd, model } = await generateSceneTakes({
      references: references.map((reference) => reference.image),
      sources: sources.map((source) => source.image),
      looks: looks.map((look) => look.image),
      ...(input.lookMode ? { lookMode: input.lookMode } : {}),
      lock,
      idea: input.idea,
      shot: input.shot,
      aspectRatio: imageAspectOf(input),
      model: imageModelOf(input),
      maxTakes: input.maxTakes,
      label: `scene:${avatar.id}`,
    });

    const common = { kind: "image" as const, avatarId: avatar.id, folderId: input.folderId ?? null };
    for (const take of rejected) {
      // Kept out of the library listing by meta.keep rather than thrown away: the user may want to look.
      await saveMedia(job.userId, {
        ...common, ...shapeOf(take.image.data), data: take.image.data, contentType: take.image.mimeType,
        meta: { idea: input.idea, shot: input.shot, prompt: take.prompt, verdict: take.verdict, keep: false, jobId: job.id },
      });
    }
    const photo = await saveMedia(job.userId, {
      ...common, ...shapeOf(kept.image.data), data: kept.image.data, contentType: kept.image.mimeType,
      meta: {
        idea: input.idea, shot: input.shot, prompt: kept.prompt, verdict: kept.verdict, keep: true, jobId: job.id,
        ...(sources.length ? { sourceMediaIds: sources.map((source) => source.mediaId) } : {}),
        ...(looks.length ? { lookMediaIds: looks.map((look) => look.mediaId), lookMode: input.lookMode ?? "match" } : {}),
      },
    });

    const retried = rejected.length ? ` The first take was rejected (${rejected[0].verdict.problems.join("; ")}) and redone.` : "";
    const flagged = kept.verdict.keep ? "" : ` Check it: ${kept.verdict.problems.join("; ")}.`;
    return {
      mediaIds: [photo.id],
      message: `Photo added to your library.${retried}${flagged}`,
      costUsd,
      meta: { model, takes: rejected.length + 1 },
    };
  },

  async submitClip(job, input: ClipJobInput): Promise<SubmittedClip> {
    const image = await getMedia(job.userId, input.imageMediaId);
    if (!image || image.kind !== "image") throw new Error("That photo is not in your library.");
    /* Both came in on a form and both decide what we are billed, so neither is
       trusted as stored: an unknown value is refused here rather than posted to
       a provider. */
    const model = requireMadeClipModel(input.model);
    const aspectRatio = input.aspectRatio === undefined ? undefined : requireClipAspectRatio(input.aspectRatio);
    /* A talking clip carries her line and its own sound; b-roll is silent and
       obeys the motion rules; a storyboard's clip brings its whole prompt. */
    const prompt = promptOf(input);

    if (aspectRatio) requireRatioForModel(model, aspectRatio);
    const submission = await withLocalFile(job.userId, image.id, (path) =>
      submitOmniClip({ imagePath: path, prompt, seconds: input.seconds, aspectRatio }),
    );
    return {
      provider: "google",
      requestId: submission.interactionId,
      // Nothing to poll at a URL: the interaction is read back by its id.
      statusUrl: "",
      costUsd: submission.costUsd,
    };
  },

  async clipStatus(job) {
    if (!job.providerRequestId) throw new Error("This clip has not been submitted yet.");
    const state = await omniClipStatus(job.providerRequestId);
    /* The provider's reason is ours to read, not hers: a failed clip tells her
       the service could not finish it, and the log says why. */
    if (state.state === "failed") console.error(`clip ${job.id}: provider says ${state.message.slice(0, 300)}`);
    return state;
  },

  async storeClip(job, input: ClipJobInput, videoUrl): Promise<StepOutcome> {
    const model = clipModelOf(input);
    const endpoint = CLIP_ENDPOINT[model];
    void videoUrl;
    if (!job.providerRequestId) throw new Error("This clip has no Omni interaction to collect.");
    /* Omni's video is inside the interaction, read again by id; the "URL" the
       status step handed over is not fetched. Its real cost comes with it. */
    const omni = await downloadOmniClip(job.providerRequestId);
    const data = omni.data;
    /* Filed where the photo is unless the form said otherwise: the clip
       animated from a "Beach day" photo belongs in Beach day. The photo may
       have been deleted while the clip rendered, in which case it is unfiled. */
    const folderId = input.folderId !== undefined
      ? input.folderId
      : ((await getMedia(job.userId, input.imageMediaId))?.folderId ?? null);
    const clip = await saveMedia(job.userId, {
      kind: "clip",
      data,
      contentType: "video/mp4",
      avatarId: job.avatarId,
      folderId,
      durationSeconds: input.seconds,
      meta: {
        sourceMediaId: input.imageMediaId,
        // Both halves: what she asked for, and the line that was actually sent.
        idea: input.idea ?? null,
        motion: input.motion,
        prompt: promptOf(input),
        speech: Boolean(input.speech),
        model,
        endpoint,
        aspectRatio: input.aspectRatio ?? null,
        providerRequestId: job.providerRequestId,
        jobId: job.id,
      },
    });
    await forgetOmniClip(job.providerRequestId);
    return {
      mediaIds: [clip.id],
      message: input.aspectRatio
        ? `Clip added to your library, ${input.aspectRatio}.`
        : "Clip added to your library.",
      /* Higgsfield's price was fixed at submission time; the duration cannot
         change after that. Omni is billed by the token, so Google's own count
         replaces the estimate when it came back. */
      costUsd: omni.costUsd ?? clipPriceUsd(endpoint, input.seconds) ?? 0,
      meta: { providerRequestId: job.providerRequestId, model, endpoint },
    };
  },

  async assembleReel(job, input: ReelJobInput): Promise<StepOutcome> {
    const draft = await getDraft(job.userId, input.draftId);
    if (!draft) throw new Error("That draft is gone.");
    const clip = await getMedia(job.userId, input.clipMediaId);
    if (!clip || clip.kind !== "clip") throw new Error("That clip is not in your library.");

    // A rebuilt reel is a new row; the heart on the one it replaces comes with it.
    const kept = draft.outputMediaId ? carriedFavorite((await getMedia(job.userId, draft.outputMediaId))?.meta) : {};

    const cached = (clip.meta as { faceZone?: FaceZone | null }).faceZone;
    const result = await withLocalFile(job.userId, clip.id, async (clipPath) => {
      // A clip is analysed once; every later hook reuses the answer from its media row.
      const faceZone = cached !== undefined ? cached : await analyseFaceZone(clipPath);
      if (cached === undefined) await updateMediaMeta(job.userId, clip.id, { faceZone });

      const dir = await mkdtemp(join(tmpdir(), "reel-out-"));
      try {
        const outPath = join(dir, `${draft.id}.mp4`);
        const profile = await getProfile(job.userId, draft.avatarId);
        // Her language matters to the drawing only for lowercasing.
        const language = input.lowercase === true ? contentLanguage(profile) : undefined;
        const keyword = keywordMarkOf(profile);
        const assembled = await assembleReel({ clipPath, hook: draft.hook, cue: input.cue, mode: input.mode, style: input.style, size: input.size, lowercase: input.lowercase, language, outPath, faceZone, ...(keyword ? { keyword } : {}) });
        const reel = await saveMedia(job.userId, {
          kind: "reel",
          data: await readFile(outPath),
          contentType: "video/mp4",
          avatarId: draft.avatarId,
          // A reel is filed with the clip it was printed on, so a shoot stays together.
          folderId: clip.folderId,
          durationSeconds: assembled.duration,
          meta: {
            draftId: draft.id,
            clipMediaId: clip.id,
            layout: assembled.layout,
            placement: assembled.placement,
            cue: assembled.cue ? { text: assembled.cue.text, at: assembled.cue.at } : null,
            mode: assembled.mode,
            style: assembled.style,
            size: assembled.size,
            ...(assembled.lowercase ? { lowercase: true } : {}),
            ...kept,
            jobId: job.id,
          },
        });
        return { assembled, reelId: reel.id };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    const previous = draft.outputMediaId;
    await updateDraft(job.userId, draft.id, {
      status: "assembled",
      clipMediaId: clip.id,
      outputMediaId: result.reelId,
      reelSeconds: String(result.assembled.duration),
    });
    // A re-assembled reel is a new row with a new URL, so the previous one is only orphaned bytes.
    if (previous && previous !== result.reelId) await deleteMedia(job.userId, previous);

    const where = {
      default: "in the usual spot",
      below_face: "under her face",
      above_face: "above her face",
      lowest_safe: "as low as the safe area allows",
    }[result.assembled.placement.reason];
    const cueNote = result.assembled.cue ? `, “${result.assembled.cue.text}” from ${result.assembled.cue.at}s` : "";
    return {
      mediaIds: [result.reelId],
      message: `Reel assembled: ${result.assembled.duration}s, text at ${result.assembled.layout.fontSize}px ${where}${cueNote}.`,
      costUsd: 0, // rendering is our own compute, and the face check is a cheap text call
      meta: { draftId: draft.id, layout: result.assembled.layout, placement: result.assembled.placement },
    };
  },

  async renderCarousel(job, input: CarouselJobInput): Promise<StepOutcome> {
    const draft = await getDraft(job.userId, input.draftId);
    if (!draft) throw new Error("That draft is gone.");
    const avatar = await getAvatar(job.userId, draft.avatarId);
    if (!avatar) throw new Error("That avatar is gone.");

    const [profile, brief] = await Promise.all([getProfile(job.userId, avatar.id), getBrief(job.userId, avatar.id)]);
    if (!profileComplete(profile)) {
      throw new Error("Fill in the Brand page first: niche, audience, offer and keyword.");
    }

    /* The private-kit rule is applied here, against the session's own user id.
       A kit id travels through the form and the job input, so it is never
       trusted: `resolveKit` throws if this account does not own it. */
    const kit = resolveKit(input.kit, {
      palette: input.palette as Partial<Palette> | undefined,
      profileSlug: kitOwnerSlug(job.userId),
    });
    const skeleton = (input.skeleton in SKELETONS ? input.skeleton : "case_study") as Skeleton;
    const format: Format = input.format === "story" ? "story" : "carousel";

    // Every photo is looked up scoped to the owner again: the ids came in on a form.
    const photoIds: string[] = [];
    for (const id of input.photoMediaIds) {
      const row = await getMedia(job.userId, id);
      // And the set's own avatar's: the last check before a photo is drawn into her slides.
      if (row && (row.kind === "image" || row.kind === "reference") && ofAvatar(row, draft.avatarId)) photoIds.push(row.id);
    }
    if (!photoIds.length) throw new Error("None of those photos are in your library any more.");
    let photos = photoMap(photoIds);

    // Checked on her whole profile above; the writer sees only what this set may use, and only the offer it sells.
    const brand = brandFlag(input.brand);
    const offer = typeof input.offer === "number" ? input.offer : pickOffer(profile, input.topic);
    // A keyword she named for this set is the one it asks for; with her brand off it asks for none.
    const keyword = brand ? input.keyword : undefined;
    const setProfile = writerProfile(withKeyword(withOffer(profile, offer), keyword), brand);
    /* Her own slides are drawn as she wrote them: nothing is written, so
       nothing is rewritten, and no keyword slide is added after her last. */
    const own = (input.slideTexts ?? []).map((text) => text.trim()).filter(Boolean);
    const name = carouselName(input.topic, kit.id, format);
    const written = own.length
      ? {
          spec: givenSpec(own, { name, format, layout: layoutFrom(input.layout), photoRefs: Object.keys(photos), language: setProfile.language, ...(keyword ? { keyword } : {}) }),
          problems: [],
          attempts: 0,
        }
      : await writeCarousel({
          // The house knowledge and her memory for this topic; with her brand off, the knowledge only.
          ...(await liveWriterContext(job.userId, avatar.id, input.topic, brand)),
          topic: input.topic,
          profile: setProfile,
          brief: writerBrief(briefForOffer(brief, profile, offer), brand),
          kit,
          skeleton,
          format,
          layout: layoutFrom(input.layout),
          name,
          photoRefs: Object.keys(photos),
          photosOnce: input.photosOnce,
          slideCount: input.slides,
          coverTitle: input.coverTitle,
          reference: input.reference,
        });
    if (!written.spec) {
      throw new Error(`The writer could not produce a set that passes the checks:\n${describeProblems(written.problems)}`);
    }
    let spec = own.length ? written.spec : withCoverTitle(written.spec, input.coverTitle);

    /* A split or grid set is a line over a picture, so the picture has to fit
       the line: once the words exist, each photo slot is matched to the photo
       that shows what it says. The writer's order stands if matching fails,
       and photos she attached keep the order she attached them in. */
    if (layoutTakesScenes(spec.layout) && !input.photosOnce) {
      const fitted = await fitPhotos(job.userId, spec, photoIds);
      if (fitted) ({ spec, photos } = fitted);
    }

    /* The face is found once per photo and kept on the photo's own row, because
       the same photo carries many sets and the answer cannot change unless the
       bytes do. */
    const loaded: Photos = {};
    for (const ref of spec.slides.flatMap(slidePhotos)) {
      if (loaded[ref]) continue;
      const mediaId = photos[ref];
      if (!mediaId) throw new Error(`No photo was supplied for ${ref}.`);
      loaded[ref] = { data: await readMedia(job.userId, mediaId), face: await faceBoxFor(job.userId, mediaId) };
    }

    // Her keyword colour is read from the brand now and kept on the set, so a slide redrawn later matches.
    const keywordColor = keywordColorOf(profile);
    const look = { size: normalizeTextSize(input.size), lowercase: input.lowercase === true, ...(keywordColor ? { keywordColor } : {}) };
    const rendered = await renderSpec(spec, kit, loaded, look);
    const frame = FORMATS[format];
    const previous = await listSlides(job.userId, draft.id);

    const renderedAt = Date.now();
    const slideIds: string[] = [];
    for (const [index, slide] of rendered.slides.entries()) {
      const row = await saveMedia(job.userId, {
        kind: "slide",
        data: slide.png,
        contentType: "image/png",
        avatarId: avatar.id,
        width: frame.width,
        height: frame.height,
        meta: { draftId: draft.id, index, jobId: job.id, renderedAt },
      });
      slideIds.push(row.id);
    }

    const doc: CarouselDoc = {
      ...spec,
      kit: kit.id,
      palette: input.palette as Partial<Palette> | undefined,
      photos,
      fixedCover: Boolean(input.coverTitle) || own.length > 0,
      size: look.size,
      ...(look.lowercase ? { lowercase: true } : {}),
      ...(keywordColor ? { keywordColor } : {}),
    };
    await saveDoc(job.userId, draft.id, doc);

    const last = spec.slides[spec.slides.length - 1];
    await updateDraft(job.userId, draft.id, {
      format,
      caption: spec.caption,
      cta: last.type === "keyword" ? askText(last, spec.language) : spec.ownSlides && keyword ? askText({ keyword }, spec.language) : "",
      status: "assembled",
      // The cover is the thumbnail, the way a reel's poster frame is.
      outputMediaId: slideIds[0],
    });
    // Only once the new set is the one on the row: a re-run leaves no orphans.
    for (const old of previous) await deleteMedia(job.userId, old.id);

    const stillFailing = written.problems.length
      ? ` ${written.problems.length} writing rule${written.problems.length === 1 ? "" : "s"} still fail: the set says which.`
      : "";
    return {
      mediaIds: slideIds,
      message: `${slideIds.length} slides rendered.${stillFailing}`,
      costUsd: 0, // the writing is a text call, which the plan covers; drawing is our own compute
      meta: { draftId: draft.id, attempts: written.attempts, problems: written.problems.length },
    };
  },

  async renderTextPhoto(job, input: TextPhotoJobInput): Promise<StepOutcome> {
    return makeTextPhoto(job, input, liveTextPhotoDeps);
  },


  async discardMedia(userId, mediaIds) {
    for (const id of mediaIds) await deleteMedia(userId, id);
  },
};

/** The prompt a clip job sends: a storyboard's own, her line to camera, or b-roll under the motion rules. */
function promptOf(input: ClipJobInput): string {
  if (input.prompt?.trim()) return input.prompt.trim();
  return input.speech ? talkingPrompt(input.motion, input.language) : clipPrompt(input.motion);
}

/* The size of a generated photo, read from its own header.
 *
 * Uploads have carried width and height since the day they were re-encoded;
 * generated photos did not, and the Animate drawer needs them to say what a
 * crop to 9:16 will actually take off this photo. A header we cannot parse
 * leaves the columns null, which is what every older row already looks like. */
function shapeOf(data: Buffer): Dimensions | Record<string, never> {
  const type = sniffImageType(data);
  return (type && imageDimensions(data, type)) || {};
}

/* The real storage and canvas behind a text_photo job. */
const liveTextPhotoDeps: TextPhotoDeps = {
  async photo(userId, mediaId) {
    const row = await getMedia(userId, mediaId);
    return row ? { ...row, meta: row.meta as Record<string, unknown> } : null;
  },
  read: (userId, mediaId) => readMedia(userId, mediaId),
  size(data) {
    const type = sniffImageType(data);
    return (type && imageDimensions(data, type)) || null;
  },
  face: (userId, mediaId) => faceBoxFor(userId, mediaId),
  draw: ({ style, size, data, face, lines, frame }) => renderTextOnPhoto({ kit: resolveKit(style), photo: { data, face }, lines, frame, size }),
  save: (userId, input) => saveMedia(userId, { kind: "image", contentType: "image/png", ...input }),
};

/** Where the face sits in a photo: asked once, then kept on the photo's row. */
async function faceBoxFor(userId: string, mediaId: string): Promise<FaceBox | null> {
  const row = await getMedia(userId, mediaId);
  if (!row) throw new Error("That photo is not in your library.");
  const cached = (row.meta as { faceBox?: FaceBox | null }).faceBox;
  if (cached !== undefined) return cached;
  const box = await withLocalFile(userId, mediaId, (path) => detectFaceBox(path));
  await updateMediaMeta(userId, mediaId, { faceBox: box });
  return box;
}
