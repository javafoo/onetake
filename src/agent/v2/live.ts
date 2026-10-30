import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { generateTurn } from "@/ai/text";
import type { Brief } from "@/brief/build";
import { writerProfile } from "@/content/brand-scope";
import { hookCount, writeHooksFor } from "@/content/hook-batch";
import { writePosts, type BrandProfile } from "@/content/hooks";
import type { Avatar } from "@/data/avatars";
import { listCarousels } from "@/data/carousels";
import { addDrafts, getDraftsByIds, listDrafts } from "@/data/drafts";
import { listMedia, saveMedia, type Media } from "@/data/media";
import { addFact, listFacts, memoryLines } from "@/data/memory";
import type { User } from "@/data/users";
import { startJobOnce } from "@/jobs";
import { logUnexpected } from "@/lib/errors";
import { imageDimensions, sniffImageType } from "@/lib/image-bytes";
import { isFavorite } from "@/lib/tile-actions";

import { affordable, ownMaterial } from "../ask";
import { liveAgentDeps } from "../live";

import type { LoopDeps } from "./loop";
import { contextText } from "./system";
import type { LibraryItem, LibraryKind, ToolDeps } from "./tools";

/* The real reads, writes and model calls behind a turn, for one user, one
   avatar and one thread. Every read is scoped to her and to this avatar,
   like the job providers; nothing an id from the model names is used before
   it has been looked up as hers. */

const MEDIA_KIND = { photo: "image", clip: "clip", reel: "reel" } as const;
const LIBRARY_MAX = 20;

const short = (value: unknown, max = 90): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** The label a library item is found by: what it shows, in her words, never a prompt or a path. */
function mediaLabel(row: Media, hooks: Map<string, string>): string {
  const meta = row.meta as Record<string, unknown>;
  const draftId = typeof meta.draftId === "string" ? meta.draftId : "";
  const said = short(hooks.get(draftId)) || short(meta.idea) || short(meta.motion) || short(meta.title);
  const when = row.createdAt.toISOString().slice(0, 10);
  return said ? `${said} (${when})` : `${row.kind === "clip" ? "Clip" : row.kind === "reel" ? "Reel" : "Photo"} from ${when}`;
}

/** Favorites first, then words in the query, at most twenty. Pure. */
export function rankLibrary(items: LibraryItem[], query: string): LibraryItem[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  const matches = (item: LibraryItem) => words.filter((word) => item.label.toLowerCase().includes(word)).length;
  return [...items]
    .filter((item) => !words.length || matches(item) > 0)
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || matches(b) - matches(a))
    .slice(0, LIBRARY_MAX);
}

export function liveToolDeps(user: User, avatar: Avatar, profile: BrandProfile, brief: Brief | null, threadId: string): ToolDeps {
  const memory = async () => memoryLines(await listFacts(user.id, avatar.id));
  return {
    // No reference source is wired yet: writers work from her brand and memory alone.
    reference: async () => "",
    memory,
    async brand() {
      return {
        avatar: avatar.name,
        personaName: profile.personaName ?? "",
        niche: profile.niche,
        audience: profile.audience,
        offer: profile.offer,
        keyword: profile.keyword,
        voice: profile.voice,
        story: profile.story ?? "",
        proofPoints: profile.proofPoints,
        oneLiner: brief?.oneLiner.text ?? "",
        remembered: await memory(),
      };
    },
    async library(kind: LibraryKind, options) {
      if (kind === "set") {
        const sets = await listCarousels(user.id, { avatarId: avatar.id, favoritesOnly: options.favorites, limit: 60 });
        const items = sets.map((set): LibraryItem => ({ id: set.draft.id, kind: "set", label: `${short(set.draft.hook) || "A set"} (${set.slideCount} slides)`, favorite: set.favorite }));
        return rankLibrary(items, options.query);
      }
      const rows = await listMedia(user.id, MEDIA_KIND[kind], { avatarId: avatar.id, orUnassigned: true, keptOnly: true, favoritesOnly: options.favorites, limit: 100 });
      const draftIds = rows.map((row) => (row.meta as { draftId?: unknown }).draftId).filter((id): id is string => typeof id === "string");
      const hooks = new Map((await getDraftsByIds(user.id, draftIds)).map((draft) => [draft.id, draft.hook]));
      return rankLibrary(
        rows.map((row) => ({ id: row.id, kind, label: mediaLabel(row, hooks), favorite: isFavorite(row.meta) })),
        options.query,
      );
    },
    async recentPosts(n) {
      const drafts = await listDrafts(user.id, { avatarId: avatar.id, limit: n });
      return drafts.map((draft) => ({
        draftId: draft.id,
        format: draft.format,
        hook: draft.hook,
        status: draft.status,
        finished: Boolean(draft.outputMediaId) || (draft.format !== "reel" && draft.spec !== null),
        createdAt: draft.createdAt.toISOString(),
      }));
    },
    async writePost(input) {
      const [post] = await writePosts(writerProfile(profile, true), 1, {
        brief: input.brief,
        ...(input.hook ? { hook: input.hook } : {}),
        ...(input.talking ? { format: "talking" as const } : {}),
        knowledge: input.knowledge,
        memory: input.memory,
      });
      if (!post) throw new Error("The writer returned nothing.");
      const [draft] = await addDrafts(user.id, avatar.id, [post]);
      return { draftId: draft.id, hook: post.hook, caption: post.caption, cta: post.cta };
    },
    async writeHooks(input) {
      const batch = await writeHooksFor(
        user,
        avatar.id,
        { count: hookCount(input.count), brand: true, ...(input.topic ? { brief: input.topic } : {}) },
        { write: (writer, count, options) => writePosts(writer, count, { ...options, knowledge: input.knowledge, memory: input.memory }) },
      );
      return { hooks: batch.hooks.map((hook) => hook.text), dropped: batch.dropped };
    },
    async ownMaterial(material) {
      const owned = await ownMaterial(user.id, avatar.id, material);
      return owned.material ?? { photos: [] };
    },
    async addFact(text) {
      return (await addFact(user.id, avatar.id, text, "agent", threadId)).text;
    },
    affordable: (credits, noun) => affordable(user, credits, noun),
    async startJob(request) {
      const started = await startJobOnce(user, request);
      return { jobId: started.view.id, created: started.created };
    },
    async saveLooks(images, requestId) {
      const saved: string[] = [];
      for (const [index, image] of images.entries()) {
        // The id is the request's, so a retried turn upserts the same row rather than saving the picture twice.
        const hash = createHash("sha256").update(`${requestId}:look:${index}`).digest("hex");
        const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
        const type = sniffImageType(image.data);
        const size = type ? imageDimensions(image.data, type) : null;
        /* Kept out of her library (`keep: false`) and out of the agent's searches: it is a picture to copy from, not a photo of her.
           Marked screened because the turn screened it before anything read it. */
        const row = await saveMedia(user.id, {
          id,
          kind: "image",
          avatarId: avatar.id,
          data: image.data,
          contentType: image.mimeType,
          ...(size ? size : {}),
          meta: { look: true, keep: false, source: "screenshot", threadId, safety: { ok: true, at: new Date().toISOString() } },
        });
        saved.push(row.id);
      }
      return saved;
    },
    newId: () => randomUUID(),
    now: () => new Date(),
  };
}

export function liveLoopDeps(user: User, avatar: Avatar, profile: BrandProfile, brief: Brief | null, threadId: string): LoopDeps {
  const tools = liveToolDeps(user, avatar, profile, brief, threadId);
  return {
    generateTurn,
    tools,
    profile,
    screen: (message) => liveAgentDeps.screenIdea(user.id, message),
    async context(budgetLeft, message) {
      /* The reference for her message is fetched here, before the first
         round, so the model writes from it instead of spending a round asking
         for it. A lookup that fails is logged and the turn goes on without. */
      const [memory, reference] = await Promise.all([
        tools.memory(),
        tools.reference(message).catch((error: unknown) => {
          logUnexpected("agent v2 reference", error);
          return "";
        }),
      ]);
      return contextText({ avatarName: avatar.name, profile, brief, memory, today: new Date().toISOString().slice(0, 10), budgetLeft, reference });
    },
    report: (error) => void logUnexpected("agent v2 turn", error),
    // Timings only, with the thread's short id; never her words.
    log: (line) => console.info(`[agent-v2] ${threadId.slice(0, 8)} ${line}`),
  };
}
