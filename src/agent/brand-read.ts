/* Brand on or off, read off her message in code: "not about my brand",
   "unrelated to my brand", "just for fun", "from scratch". Narrow on purpose,
   so a brief about "my brand story" stays on. The Brand chip wins over these
   when she set it (src/agent/options.ts). Pure, and safe in the browser. */

const MINE = "(?:my|her)\\s+(?:brand|business|offer|niche)";

const OFF = [
  new RegExp(`\\bnot\\s+(?:about|related to|tied to|for|linked to)\\s+${MINE}\\b`),
  new RegExp(`\\bunrelated\\s+to\\s+${MINE}\\b`),
  new RegExp(`\\bnothing\\s+to\\s+do\\s+with\\s+${MINE}\\b`),
  new RegExp(`\\b(?:without|leave out|forget|ignore|skip)\\s+${MINE}\\b`),
  /\bjust\s+for\s+fun\b/,
  /\bfrom\s+scratch\b/,
];

/** Whether her message asks for this one to be written without her brand. */
export function brandOffInMessage(message: string): boolean {
  const text = message.toLowerCase().replace(/[’']/g, "'");
  return OFF.some((pattern) => pattern.test(text));
}

/** The chip when she set it, otherwise what her words said; on unless either says off. */
export function brandForMessage(picked: unknown, message: string): boolean {
  if (typeof picked === "boolean") return picked;
  return !brandOffInMessage(message);
}
