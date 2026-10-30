/* The guided setup interview.

   Not a chat. Each step asks one question and she answers it in her own words.
   The whole thing is a few minutes and it is resumable.

   The copy lives here so the UI and the tests read the same words. `good` and
   `passTest` say what a strong answer looks like: could this describe fifty
   other accounts in the niche, and is there a real person in it with a real
   frustration. */

export const STEP_IDS = ["audience", "problem", "offer", "story", "proof", "pov", "voice"] as const;
export type StepId = (typeof STEP_IDS)[number];

export const STORY_BEATS = ["before", "turn", "now"] as const;
export type StoryBeat = (typeof STORY_BEATS)[number];

/** How many times one step may be sent back for a sharper answer. Nothing sends one back today. */
export const MAX_PUSHBACKS = 2;

export type Field = {
  id: string;
  question: string;
  help: string;
  example: string;
};

export type Step = {
  id: StepId;
  /** Short label for the progress rail. */
  title: string;
  question: string;
  /** One line under the question. */
  help: string;
  /** What a good answer looks like. */
  good: string;
  example: string;
  /** What a strong answer passes. */
  passTest: string;
  /** False where nothing may ever put words in her mouth. */
  aiSuggests: boolean;
  /** Sub-questions for the steps that hold more than one box. */
  fields?: readonly Field[];
};

export const STEPS: readonly Step[] = [
  {
    id: "audience",
    title: "Who you talk to",
    question: "Who are you talking to?",
    help: "One person in one situation, not a category.",
    good:
      "A person you could picture on a Tuesday night: what their week looks like, what they have already tried, what they are afraid of.",
    example:
      "Women in their thirties who have booked the same haircut for years because they are scared to try something new, and want a stylist who will tell them honestly what suits them.",
    passTest:
      "You can describe this person's Tuesday night scroll: what they just watched, what they are feeling, why your post would stop their thumb.",
    aiSuggests: true,
  },
  {
    id: "problem",
    title: "What they are stuck on",
    question: "What is that person stuck on? Say it the way they would say it.",
    help: "The sentence they would text a friend at 11pm, not the industry word for it.",
    good: "One specific stuck point, in their words, including the thing they already tried that did not work.",
    example:
      "\"I have saved fifty hair photos and I still leave every appointment looking exactly the same.\"",
    passTest: "It is a sentence a real person would say out loud, and it names something they already tried.",
    aiSuggests: true,
  },
  {
    id: "offer",
    title: "What you sell",
    question: "What do you sell or give away, and what word do they comment to get it?",
    help: "One thing, with its price or the word free. One keyword: a single word, easy to spell.",
    good: "A named thing, what it gets them, what it costs, and a keyword someone could type without thinking.",
    example: "A free 15-minute consult to plan your next cut and colour. Keyword: CONSULT",
    passTest: "A stranger could repeat what they get, what it costs, and what to comment.",
    aiSuggests: true,
    fields: [
      {
        id: "text",
        question: "What is it, and what does it cost?",
        help: "Name it, say what they get, say the price or say it is free.",
        example: "A free 15-minute consult to plan your next cut and colour.",
      },
      {
        id: "keyword",
        question: "What single word do they comment?",
        help: "One word, no spaces. Short enough to type on a phone without a typo.",
        example: "CONSULT",
      },
    ],
  },
  {
    id: "story",
    title: "Your story",
    question: "Your story in three beats: where you were, what changed, where you are now.",
    help: "Only what actually happened. This is the only personal history the app will ever write about you.",
    good: "Three short beats with the thinking in them: the reaction, the assumption, the moment it clicked.",
    example:
      "Before: I was cutting hair in a busy chain salon, rushing every client through in forty minutes. Turn: in 2022 I opened my own two-chair studio so I could take my time. Now: I am booked six weeks out, mostly by people who found me online.",
    passTest: "Each beat is something that happened to you, not a feeling or a slogan.",
    aiSuggests: true,
    fields: [
      {
        id: "before",
        question: "Where were you before this worked?",
        help: "The low point. What was actually happening.",
        example: "I was cutting hair in a busy chain salon, rushing every client through in forty minutes.",
      },
      {
        id: "turn",
        question: "What changed?",
        help: "The decision, the thing you tried, the moment it clicked.",
        example: "In 2022 I opened my own two-chair studio so I could take my time with every client.",
      },
      {
        id: "now",
        question: "Where are you now?",
        help: "Only what is true today. No rounding up.",
        example: "I am booked six weeks out, mostly by people who found me online.",
      },
    ],
  },
  {
    id: "proof",
    title: "Your proof",
    question: "What numbers and facts can you stand behind?",
    help: "One fact per line, each something you could screenshot today. Followers, views, posts, streaks. Not money: revenue and income figures are never used in captions. You type these: we never write a number for you.",
    good: "Three to five short lines, one checkable fact each, no sentences and no money.",
    example: "Booked six weeks out. 212 five-star reviews. 1,400 local followers.",
    passTest: "Every line is checkable, and none of it is rounded up or borrowed from someone else.",
    aiSuggests: false,
  },
  {
    id: "pov",
    title: "What you believe",
    question: "What do you believe about your niche that other people in it do not say?",
    help: "Something you learned by doing it, that would mildly annoy one other creator.",
    good: "A belief you could argue for ten minutes, with the reason you hold it.",
    example:
      "Most bad haircuts are a communication problem, not a skill problem. Ten honest minutes before the scissors come out saves months of growing it out.",
    passTest:
      "Some of your audience would nod hard and at least one other creator in your niche would disagree with it.",
    aiSuggests: true,
  },
  {
    id: "voice",
    title: "How you sound",
    question: "How do you sound?",
    help: "A few words for your voice, then one caption written the way you would post it.",
    good: "Words a friend would use about how you talk, and a caption you would send without editing it first.",
    example: "Warm, honest, a little cheeky.",
    passTest: "You would post the caption as it is.",
    aiSuggests: false,
    fields: [
      {
        id: "label",
        question: "Your voice in a few words",
        help: "How a friend would describe the way you talk.",
        example: "Warm, honest, a little cheeky.",
      },
      {
        id: "caption",
        question: "One caption, the way you would post it",
        help: "Any post. This is how the writer learns your rhythm.",
        example: "Bring me the photo, but also tell me how long you spend on your hair in the morning. That one answer changes everything.",
      },
    ],
  },
];

const BY_ID = new Map(STEPS.map((item) => [item.id, item]));

export function step(id: StepId): Step {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown step: ${id}`);
  return found;
}

export function stepIndex(id: StepId): number {
  return STEP_IDS.indexOf(id);
}

export function field(id: StepId, fieldId: string): Field {
  const found = step(id).fields?.find((item) => item.id === fieldId);
  if (!found) throw new Error(`Step ${id} has no field ${fieldId}`);
  return found;
}
