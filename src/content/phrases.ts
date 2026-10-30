/* Where a quote's lines break when nobody broke them: at the pauses a reader
   makes. The small text size sets one phrase to a line, the way the founder's
   reference quote is typed (2026-09-24). Pure: the width of a line comes from
   the caller's `measure`, so the renderers pass the real font and the tests
   pass a character count. */

type Measure = (line: string) => number;

const tidy = (text: string) => text.trim().replace(/\s+/g, " ");

/** Sentences, each keeping its closing mark: split after . ! ? or … where a space follows. */
export function sentences(text: string): string[] {
  return tidy(text).split(/(?<=[.!?…]["”’)]?)\s+/).filter(Boolean);
}

/** A sentence cut at its commas, colons, semicolons and dashes, each mark kept at the end of its phrase. */
export function clauses(sentence: string): string[] {
  return tidy(sentence)
    .replace(/\s+([—–]|-{1,2})\s+/g, " $1\n")
    .replace(/([,;:])\s+/g, "$1\n")
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean);
}

function greedy(words: string[], measure: Measure, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || measure(candidate) <= maxWidth) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** A phrase too wide for one line, in the fewest lines of even width: greedy wrapping would leave one word alone. */
export function wrapEvenly(phrase: string, measure: Measure, maxWidth: number): string[] {
  const words = tidy(phrase).split(" ").filter(Boolean);
  const first = greedy(words, measure, maxWidth);
  if (first.length < 2) return first;
  let low = 0;
  let high = maxWidth;
  let best = first;
  while (high - low > 0.5) {
    const mid = (low + high) / 2;
    const attempt = greedy(words, measure, mid);
    if (attempt.length <= first.length && attempt.every((line) => measure(line) <= maxWidth)) {
      best = attempt;
      high = mid;
    } else low = mid;
  }
  return best;
}

/**
 * Her words as lines broken at natural pauses.
 *
 * Her own line breaks win: when the words have any, each of her lines is
 * kept and wrapped only if it is too wide. Otherwise a sentence that fits
 * is one line; one that does not is cut at its commas, colons, semicolons and
 * dashes; and a phrase still too wide is wrapped evenly. Nothing is added,
 * dropped or re-cased: the lines joined with spaces are her words.
 */
export function phraseLines(text: string, measure: Measure, maxWidth: number): string[] {
  const own = text.split(/\r?\n/).map(tidy).filter(Boolean);
  if (own.length > 1) return own.flatMap((line) => (measure(line) <= maxWidth ? [line] : wrapEvenly(line, measure, maxWidth)));
  const lines: string[] = [];
  for (const sentence of sentences(text)) {
    if (measure(sentence) <= maxWidth) {
      lines.push(sentence);
      continue;
    }
    for (const phrase of clauses(sentence)) {
      lines.push(...(measure(phrase) <= maxWidth ? [phrase] : wrapEvenly(phrase, measure, maxWidth)));
    }
  }
  return lines;
}
