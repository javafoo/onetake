import { agentCredits } from "@/agent/plan";
import { generateText as geminiText } from "@/ai/gemini";
import { NEMOTRON_MODELS } from "@/ai/nemotron";
import { search } from "@/ai/tavily";
import { generateText } from "@/ai/text";
import { writePosts } from "@/content/hooks";
import { getAvatar, primaryAvatar } from "@/data/avatars";
import { getProfile, profileComplete } from "@/data/brand";
import { addFact, listFacts } from "@/data/memory";
import { getStorage } from "@/lib/get-storage";

import { makeRequest, type Format } from "./plan";
import type { WeekDeps } from "./step";

/* The week's real calls. Thinking is Nemotron through `@/ai/text` (which
   answers with Gemini only if Nemotron is down); listening is Gemini, the one
   model here that hears audio; search is Tavily. */

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** A post of each format as the week would ask for it, priced by the same rules as any agent run. */
function formatPrices(): Record<Format, number> {
  const price = (format: Format) => agentCredits(makeRequest({ format, angle: "", why: "", facts: [0], status: "planned", mediaIds: [] }));
  return { reel: price("reel"), carousel: price("carousel"), photo: price("photo") };
}

export const liveWeekDeps: WeekDeps = {
  async brand(userId, avatarId) {
    const row = (avatarId ? await getAvatar(userId, avatarId) : null) ?? (await primaryAvatar(userId));
    if (!row) return null;
    const profile = await getProfile(userId, row.id);
    return profileComplete(profile) ? { avatarId: row.id, profile } : null;
  },

  async transcribe(_userId, audio) {
    // The path was made from her user id when the note was stored, so it can only be hers.
    const { stream } = await getStorage().get(audio.pathname);
    const data = await readAll(stream);
    return geminiText<string>({
      system: "You transcribe voice notes word for word. Return only the words spoken, with punctuation. No labels, no summary.",
      prompt: "Transcribe this voice note.",
      images: [{ mimeType: audio.mimeType, data }],
    });
  },

  think: (options) => generateText(options),

  modelName: (tier) => `NVIDIA ${NEMOTRON_MODELS[tier]().replace(/^nvidia\//, "")}`,

  // The whole web from the past week: niche conversations are rarely in the news index.
  search: (query) => search({ query, topic: "general", timeRange: "week", maxResults: 6 }),

  async write(profile, options) {
    const [post] = await writePosts(profile, 1, { brief: options.brief, memory: options.memory, ...(options.talking ? { format: "talking" as const } : {}) });
    if (!post) throw new Error("The writer returned no post.");
    return post;
  },

  async remember(userId, avatarId, facts) {
    const known = new Set((await listFacts(userId, avatarId)).map((fact) => fact.text.toLowerCase()));
    for (const fact of facts) {
      if (known.has(fact.toLowerCase())) continue;
      await addFact(userId, avatarId, fact, "agent");
      known.add(fact.toLowerCase());
    }
  },

  prices: formatPrices,

  async spent(userId, runId) {
    // Loaded here: the job machine imports this module, so a top-level import would be a cycle.
    const { getJobRecord } = await import("@/jobs");
    const record = await getJobRecord(userId, runId);
    const state = record?.input.kind === "agent" ? record.input.state : undefined;
    return state?.creditsSpent ?? 0;
  },
};
