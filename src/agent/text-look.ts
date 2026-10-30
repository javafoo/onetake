import type { TextSize } from "@/content/text-styles";

import { drawsWords, type AgentRequest } from "./plan";

/* Size and case, read off her message in code rather than by the reader:
   "small text", "smaller", "big text", "lowercase", "all lowercase". The
   phrases are narrow on purpose, so a brief about "smaller accounts" is not
   read as a request for small type. The Text picker wins over these when she
   changed it there (src/agent/options.ts). */

export type TextLookAsk = { size?: TextSize; lowercase?: boolean };

const TEXT_WORDS = "(?:text|words?|font|type|letters|writing|caption|captions|quote|hook|lettering)";
const SOFTENER = "(?:a bit |a little |a lot |much |way |even )?";

const SMALL = [
  new RegExp(`\\b(?:small|smaller|tiny|little|minimal)\\s+${TEXT_WORDS}\\b`),
  new RegExp(`\\b${TEXT_WORDS}\\s+(?:is |should be |to be )?${SOFTENER}(?:small|smaller|tiny)\\b`),
  new RegExp(`\\b(?:make|set|keep|put)\\s+(?:it|them|the text|the words|the hook|the quote)\\s+${SOFTENER}(?:small|smaller)\\b`),
  // "smaller" on its own as the whole ask, or closing it: "smaller please".
  /^\s*(?:a bit |a little |much )?smaller\b/,
  /\bsmaller\s*(?:please|pls|this time)?\s*[.!]?\s*$/,
];

const LARGE = [
  new RegExp(`\\b(?:big|bigger|large|larger|huge)\\s+${TEXT_WORDS}\\b`),
  new RegExp(`\\b${TEXT_WORDS}\\s+(?:is |should be |to be )?${SOFTENER}(?:big|bigger|large|larger)\\b`),
  new RegExp(`\\b(?:make|set|keep|put)\\s+(?:it|them|the text|the words|the hook|the quote)\\s+${SOFTENER}(?:big|bigger|large|larger)\\b`),
];

const LOWER = [/\b(?:all\s+)?lower\s?-?case\b/, /\bno\s+(?:capitals|caps|capital letters)\b/, /\bwithout\s+(?:capitals|caps|capital letters)\b/];
const KEEP_CASE = [/\b(?:keep|with)\s+(?:my|the|her)\s+(?:capitals|caps|capital letters)\b/, /\bnot\s+(?:all\s+)?lower\s?-?case\b/, /\bno\s+lower\s?-?case\b/];

/** What her message says about the size and case of the words, and nothing when it says nothing. */
export function textLookFromMessage(message: string): TextLookAsk {
  const text = message.toLowerCase();
  const small = SMALL.some((pattern) => pattern.test(text));
  const large = LARGE.some((pattern) => pattern.test(text));
  const keepCase = KEEP_CASE.some((pattern) => pattern.test(text));
  const lower = !keepCase && LOWER.some((pattern) => pattern.test(text));
  return {
    // Both at once is no answer: leave the size to the picker.
    ...(small !== large ? { size: small ? ("small" as const) : ("large" as const) } : {}),
    ...(lower ? { lowercase: true } : keepCase ? { lowercase: false } : {}),
  };
}

/** The asked-for size and case laid onto a request that draws words; photos draw none unless words go on them. */
export function withTextLook<R extends AgentRequest>(request: R, ask: TextLookAsk): R {
  if (request.kind === "photos" && !drawsWords(request)) return request;
  return { ...request, ...(ask.size ? { size: ask.size } : {}), ...(ask.lowercase !== undefined ? { lowercase: ask.lowercase } : {}) };
}
