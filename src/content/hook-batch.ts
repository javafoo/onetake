import { MAX_MESSAGE_CHARS } from "@/agent/plan";
import { avatarOrPrimary } from "@/data/avatars";
import { getProfile, profileComplete } from "@/data/brand";
import { addHooks, type Hook } from "@/data/hooks";
import type { User } from "@/data/users";
import { InvalidRequestError } from "@/lib/errors";
import { lazySpend, type Spend } from "@/spend/lazy";

import { writerProfile } from "./brand-scope";
import { writePosts, type BrandProfile, type PostIdea, type WriteOptions } from "./hooks";
import { liveWriterContext, referenceQuery, writerContext, type WriterContext, type WriterContextDeps } from "./writer-context";

/* New hooks from the writer, saved to Hooks: the Hooks page's "Write hooks",
   apart from the session. Only the words are kept: a caption is written when
   a hook becomes a reel, for that reel, not here. A model call that is not a
   job, so the limit and the daily cap are applied here, the only place that
   sees them. */

export type HookBatch = {
  /** The hooks written and saved, in the writer's order. */
  hooks: Hook[];
  /** How many the writer wrote that she already had, and were not saved again. */
  dropped: number;
};

export interface HookBatchDeps {
  spend: Spend;
  write: (profile: BrandProfile, count: number, options: WriteOptions) => Promise<PostIdea[]>;
  /** The retriever and memory behind the writer's reference material; the live ones when absent. */
  context: WriterContextDeps;
}

/**
 * The writer's options for one batch: her topic, and the reference material
 * found for it. Retrieval runs on what the hooks are about (her niche and
 * audience, which are empty with the brand off) so the playbooks' hook
 * sections come first.
 */
export async function batchOptions(
  userId: string,
  avatarId: string,
  profile: BrandProfile,
  opts: { brand: boolean; brief: string },
  context?: WriterContextDeps,
): Promise<WriteOptions> {
  const query = referenceQuery(opts.brief, profile.niche, profile.audience, "hooks");
  const found: WriterContext = context
    ? await writerContext(userId, avatarId, query, opts.brand, context)
    : await liveWriterContext(userId, avatarId, query, opts.brand);
  return { ...(opts.brief ? { brief: opts.brief } : {}), ...found };
}

/** Between one and ten; anything unreadable is five, as the page's form always was. */
export function hookCount(value: unknown): number {
  return Math.min(10, Math.max(1, Number(value) || 5));
}

export async function writeHooksFor(
  user: User,
  avatarId: string | null,
  opts: { count: number; brand: boolean; brief?: string },
  deps: Partial<HookBatchDeps> = {},
): Promise<HookBatch> {
  // Writing reads the Brand page, so both have to exist before the writer is paid.
  const avatar = await avatarOrPrimary(user.id, avatarId);
  const profile = await getProfile(user.id, avatar?.id ?? null);
  if (!avatar || !profileComplete(profile)) {
    throw new InvalidRequestError("Fill in the Brand page first: niche, audience, offer and keyword.");
  }
  const brief = typeof opts.brief === "string" ? opts.brief.trim() : "";
  if (brief.length > MAX_MESSAGE_CHARS) throw new InvalidRequestError(`Keep the topic under ${MAX_MESSAGE_CHARS} characters.`);
  const count = hookCount(opts.count);
  const write = deps.write ?? writePosts;
  const scoped = writerProfile(profile, opts.brand);
  // Retrieved inside the spend, so a batch the limit refuses costs not even the embedding. It never fails the batch.
  const posts = await (deps.spend ?? lazySpend)(user, { limit: "hooks", shape: "write_hooks" }, async () =>
    write(scoped, count, await batchOptions(user.id, avatar.id, scoped, { brand: opts.brand, brief }, deps.context)));
  const hooks = await addHooks(user.id, avatar.id, posts.map((post) => post.hook));
  return { hooks, dropped: Math.max(0, posts.length - hooks.length) };
}
