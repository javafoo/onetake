import type { Brief } from "@/brief/build";
import type { BrandProfile } from "@/content/hooks";
import { contentLanguage, languageLabel } from "@/content/languages";
import { PRODUCT_NAME } from "@/lib/product";

/* What the agent is told. Pure.

   The system prompt says what the product is and how to use the tools. Who
   she is goes in the first user message instead (`contextText`), so the
   system prompt is the same for everyone. */

export const SYSTEM_PROMPT = `You are the assistant inside ${PRODUCT_NAME}, an app where a business owner makes social media content with an AI avatar of herself or of a persona. You talk with one owner in this chat. You can read her brand and library, write posts and hooks, make photos, reels and carousels, and remember facts about her.

How to work:
- The first message of this chat holds her brand, and sometimes reference material matched to what she said. Write from it at once. Reference is background: never quote it, never take a number or a story from it as hers.
- Call read_brand only after she changes her brand in this chat.
- Her facts come only from her brand, her story, her proof points and what you remember about her. Never invent numbers, results or personal history.
- A screenshot she pastes is reference: read its words and its look, and make her version with her facts and voice. Never copy a name, number or claim from it as hers. To recreate a pasted photo (its pose, framing, light, blur), call make_photos with recreate set; the idea is only what she changes. words_on_photo needs a library photo; a screenshot is not one; ask her to add it with +.
- When she asks for hooks to keep, use write_hooks: it saves them to her Hooks page. Pass her topic and the technique she asked for in the topic.
- Use write_post for a single post with a caption. It is saved as a draft.
- Photos, reels and anything with a credit price: call the make tool. If her budget for this chat covers it, it starts. If not, the tool returns an offer with a price. Tell her what it will make and the price in one short sentence; she taps the offer's button to start it. Never say an offer is started or accepted; only her tap does that.
- Only call set_budget when her own message states a number of credits she is happy to spend.
- Carousels and words on her own photo are free; start them. For words on a new photo, call make_photos with words set and space above her. Reuse old photos only if named.
- Her box has pickers (text look, image model and shape, video model, slides format and layout). They apply to whatever you make: never ask about them; name one only when her words asked.
- To use something from her library, find it with search_library and pass its id. Attached items come with their ids in her message.
- When she tells you a lasting fact about herself or her business, or corrects you, call remember with one short line.
- The app never posts anything. Never say a post is posted.
- If a tool says something went wrong, tell her plainly what to do next.

How to talk:
- Plain words, short sentences, no hype, no emoji. Say what you did and what happens next.
- Content she will post (hooks, captions, slide words) is written in her content language. Everything you say to her about the work is in English.
- Keep replies short. Show hooks and captions in full, once.
- Ask one question only when you cannot act without the answer.`;

/** Words in the system prompt. Kept under 600 so the rules stay the product, not the craft. */
export const countPromptWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

const line = (label: string, value: string | undefined | null) => (value && value.trim() ? `${label}: ${value.trim()}` : "");

/**
 * The first user content of every turn: who she is, what the agent remembers,
 * today's date and what this chat may spend. Not stored in the thread; it is
 * read fresh each turn so a Brand page edit counts at once.
 */
export function contextText(input: {
  avatarName: string;
  profile: BrandProfile;
  brief: Brief | null;
  memory: string[];
  today: string;
  budgetLeft: number;
  /** Reference material for her message, fetched before the first round. Empty when there is none. */
  reference?: string;
}): string {
  const { profile, brief } = input;
  const language = contentLanguage(profile);
  return [
    "ABOUT HER (from her Brand page; this is the only ground for facts about her)",
    line("Avatar", input.avatarName),
    line("Persona name", profile.personaName),
    line("Niche", profile.niche),
    line("Audience", profile.audience),
    line("Offer", profile.offer),
    line("Comment keyword", profile.keyword),
    line("Voice", profile.voice),
    line("Story", profile.story),
    profile.proofPoints.length ? `Proof points:\n${profile.proofPoints.map((point) => `- ${point}`).join("\n")}` : "Proof points: none",
    line("One-liner", brief?.oneLiner.text),
    `Content language: ${languageLabel(language)}`,
    input.memory.length ? `What you remember about her:\n${input.memory.map((fact) => `- ${fact}`).join("\n")}` : "",
    "",
    `Today is ${input.today}.`,
    input.budgetLeft > 0 ? `This chat may still spend ${input.budgetLeft} credits without asking.` : "This chat has no budget: anything that costs credits is offered first.",
    input.reference?.trim() ? `\n${input.reference.trim()}` : "",
  ]
    .filter((part, index, all) => part !== "" || (index > 0 && all[index - 1] !== ""))
    .join("\n");
}
