import { autoPickPhotos } from "@/carousel/pick";
import { writePosts } from "@/content/hooks";
import { writePhotoWords } from "@/content/photo-quote";
import { liveWriterContext } from "@/content/writer-context";
import { inspectIdea, sentence } from "@/content/motion";
import { getAvatar, identityLock, primaryAvatar } from "@/data/avatars";
import { getBrief, getProfile, profileComplete } from "@/data/brand";
import { createCarouselDraft, photoOptions } from "@/data/carousels";
import { addDrafts } from "@/data/drafts";
import { createFolder, listFolders } from "@/data/folders";
import { getMedia, listMedia } from "@/data/media";

import { direct, type DescribedClip } from "./direct";
import { planScenes } from "./scenes";
import type { AgentDeps } from "./step";

/* The real reads and model calls behind an agent run. Everything here takes
   the owner's id and reads only that owner's rows, like the job providers.

   The safety screen is imported when it is needed rather than at the top:
   `src/safety/screen.ts` is server-only, and this module is reached from the
   job machine, which the unit tests load without a server. */

/** How a clip in the library is described to the director: the scene of the photo it came from, and its motion. */
function describeClip(meta: Record<string, unknown>, sourceIdea: string | null): string | null {
  const parts = [sourceIdea, typeof meta.idea === "string" ? meta.idea : null, typeof meta.motion === "string" ? meta.motion : null].filter(
    (part): part is string => Boolean(part && part.trim()),
  );
  if (parts.length === 0) return null;
  return [...new Set(parts.map((part) => part.trim()))].join(". ").slice(0, 400);
}

export const liveAgentDeps: AgentDeps = {
  async brand(userId, avatarId) {
    const row = (avatarId ? await getAvatar(userId, avatarId) : null) ?? (await primaryAvatar(userId));
    if (!row) return null;
    const [profile, brief] = await Promise.all([getProfile(userId, row.id), getBrief(userId, row.id)]);
    if (!profileComplete(profile)) return null;
    return { avatarId: row.id, avatarName: row.name, profile, lock: identityLock(row), brief };
  },

  async screenIdea(userId, idea) {
    const { screenSceneIdea } = await import("@/safety/screen");
    const { refuse } = await import("@/safety/refusals");
    const verdict = await screenSceneIdea(idea);
    if (!verdict.ok) await refuse(userId, "scene_idea", verdict);
  },

  writeWords: (profile, brief, knowledge) => writePhotoWords(profile, brief, undefined, knowledge),

  writerContext: liveWriterContext,

  async write(profile, options) {
    const [post] = await writePosts(profile, 1, options);
    if (!post) throw new Error("The writer returned nothing. Try again.");
    return post;
  },

  direct,

  /* The writer already writes two filmable beats; the rules are applied in
     code and nothing is reworded. The model polish the Animate drawer uses
     compressed a two-beat line to one on the first live run, which is the
     still-with-a-sway clip the founder called boring. */
  async polishMotion(motion) {
    const { kept } = inspectIdea(motion);
    return kept ? sentence(kept) : motion.trim();
  },

  planScenes,

  async libraryClips(userId, avatarId) {
    const clips = await listMedia(userId, "clip", { limit: 60, avatarId, orUnassigned: true });
    const described: DescribedClip[] = [];
    for (const clip of clips) {
      const meta = clip.meta as Record<string, unknown>;
      // A talking clip cannot sit under a different hook: it says one thing.
      if (meta.speech === true) continue;
      const source = typeof meta.sourceMediaId === "string" ? await getMedia(userId, meta.sourceMediaId) : null;
      const sourceIdea = source && typeof (source.meta as { idea?: unknown }).idea === "string" ? ((source.meta as { idea: string }).idea) : null;
      const description = describeClip(meta, sourceIdea);
      if (description) described.push({ mediaId: clip.id, description });
    }
    return described;
  },

  async addDraft(userId, avatarId, post) {
    const [draft] = await addDrafts(userId, avatarId, [post]);
    if (!draft) throw new Error("The draft could not be saved.");
    return draft.id;
  },

  async photoVerdict(userId, mediaId) {
    const row = await getMedia(userId, mediaId);
    const meta = (row?.meta ?? {}) as { keep?: unknown; verdict?: { problems?: unknown } };
    const problems = Array.isArray(meta.verdict?.problems) ? meta.verdict.problems.filter((item): item is string => typeof item === "string") : [];
    return { keep: meta.keep !== false, problems };
  },

  /* A folder of that name is reused: asking twice for the same set, or
     correcting the first ask, should fill one folder rather than make a row
     of near-identical ones. */
  async createFolder(userId, name) {
    const existing = (await listFolders(userId)).find((folder) => folder.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    try {
      return (await createFolder(userId, name)).id;
    } catch {
      return null; // the folder cap is reached: the photos are still made, just unfiled
    }
  },

  async carouselDraft(userId, avatarId, input) {
    return (await createCarouselDraft(userId, avatarId, input)).id;
  },

  async carouselPhotos(userId, avatarId, count, layout) {
    return autoPickPhotos(await photoOptions(userId, avatarId), count, layout);
  },
};
