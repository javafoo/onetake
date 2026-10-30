/* Title copy carries one piece of markup: *emphasis*. Parsing it is pure string
   work, so the checks and the renderer agree on what a word is without a canvas. */

export type Run = { text: string; emphasis: boolean };

const TOKEN = /(\*[^*]+\*)/g;

/** Splits a title line into runs, keeping the spaces on the plain runs so the
    drawn line measures the same as the unmarked line. */
export function parseEmphasis(line: string): Run[] {
  const runs: Run[] = [];
  for (const part of line.split(TOKEN)) {
    if (!part) continue;
    const emphasis = part.length > 2 && part.startsWith("*") && part.endsWith("*");
    runs.push({ text: emphasis ? part.slice(1, -1) : part, emphasis });
  }
  return runs.length ? runs : [{ text: line, emphasis: false }];
}

/** The line as the reader sees it, with the markers removed. */
export function plainText(line: string): string {
  return parseEmphasis(line)
    .map((run) => run.text)
    .join("");
}

export function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

export function countWords(text: string): number {
  return words(plainText(text)).length;
}

/** Every word inside *markers* on a line. */
export function emphasisWords(line: string): string[] {
  return parseEmphasis(line)
    .filter((run) => run.emphasis)
    .flatMap((run) => words(run.text));
}
