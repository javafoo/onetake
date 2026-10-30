/** Which of `words` appear in `text` as whole words. Case-insensitive; a word
    may contain spaces or punctuation. The matcher is here, apart from the
    lists it is usually run over, so a test can use it without the house style. */
export function matchWords(text: string, words: readonly string[]): string[] {
  const lower = text.toLowerCase();
  const hits = words
    .map((word) => word.toLowerCase())
    .filter((word) =>
      new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(lower),
    );
  return [...new Set(hits)];
}
