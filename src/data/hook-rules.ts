/* The rules of the Hooks page, with nothing behind them: no database, no
   Node built-ins. The list runs in the browser and needs the filters, the
   marks and the links; `src/data/hooks.ts` builds its queries on the same
   rules, so "not used yet" means one thing in both places. */

export type HookFilter = "unused" | "used" | "archived" | "all";

export const HOOK_FILTERS: { id: HookFilter; label: string }[] = [
  { id: "unused", label: "Not used yet" },
  { id: "used", label: "Used" },
  { id: "archived", label: "Archived" },
  { id: "all", label: "All" },
];

export const DEFAULT_HOOK_FILTER: HookFilter = "unused";

/* A saved hook is words she keeps, not yet a reel: a long story hook is kept
   whole, and the reel's own word limit applies only when free-typed words are
   put on a clip. */
export const MAX_SAVED_HOOK_WORDS = 200;
export const MAX_SAVED_HOOK_CHARS = 1500;

/** Longer than any hook; a search box is not where a hook is typed in full. */
export const MAX_HOOK_QUERY = 100;

export function parseHookFilter(raw: string | string[] | undefined): HookFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return HOOK_FILTERS.some((item) => item.id === value) ? (value as HookFilter) : DEFAULT_HOOK_FILTER;
}

export function parseHookQuery(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_HOOK_QUERY);
}

/**
 * What a filter asks of a row. `null` is "either". Archived hooks leave the
 * two working views; "All" is the one place everything shows at once.
 */
export function hookFilterSpec(filter: HookFilter): { archived: boolean | null; used: boolean | null } {
  switch (filter) {
    case "unused":
      return { archived: false, used: false };
    case "used":
      return { archived: false, used: true };
    case "archived":
      return { archived: true, used: null };
    case "all":
      return { archived: null, used: null };
  }
}

/** The dates a hook carries, as the list and the filters read them. */
export type HookMarks = {
  archivedAt: Date | string | null;
  usedReelAt: Date | string | null;
  usedCarouselAt: Date | string | null;
  copiedAt: Date | string | null;
};

/** Made into a reel or a set, or copied out to be posted by hand. */
export const isUsedHook = (hook: HookMarks): boolean => Boolean(hook.usedReelAt || hook.usedCarouselAt || hook.copiedAt);

export function matchesHookFilter(hook: HookMarks, filter: HookFilter): boolean {
  const spec = hookFilterSpec(filter);
  if (spec.archived !== null && Boolean(hook.archivedAt) !== spec.archived) return false;
  if (spec.used !== null && isUsedHook(hook) !== spec.used) return false;
  return true;
}

/** The small marks beside a hook: what it became. */
export function hookUseLabels(hook: HookMarks): string[] {
  return [hook.usedReelAt && "Reel", hook.usedCarouselAt && "Carousel", hook.copiedAt && "Copied"].filter((label): label is string => Boolean(label));
}

/**
 * The form the database compares, `lower(trim(text))` in the unique index.
 * JavaScript's trim takes more kinds of space than Postgres's, so text is
 * stored already trimmed (`cleanHookText`) and the two agree on what is kept.
 */
export const normaliseHookText = (text: string): string => text.trim().toLowerCase();

/**
 * A hook as it is stored: trimmed, runs of spaces made one. Line breaks stay,
 * at most one blank line in a row: a hook written in groups is drawn in groups.
 */
export const cleanHookText = (raw: unknown): string =>
  String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Several hooks in, each once: blanks dropped, repeats (by normalised text) dropped, first kept. */
export function dedupeHookTexts(texts: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of texts) {
    const text = cleanHookText(raw);
    const key = normaliseHookText(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/** A search typed into the box, safe inside `ILIKE '%…%'`: the wildcards she typed are matched literally. */
export const likePattern = (query: string): string => `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

/** The page's own URL for a filter and a search, without the defaults. */
export function hooksHref(filter: HookFilter, query = ""): string {
  const params = new URLSearchParams();
  if (filter !== DEFAULT_HOOK_FILTER) params.set("show", filter);
  if (query) params.set("q", query);
  const qs = params.toString();
  return qs ? `/hooks?${qs}` : "/hooks";
}

/** Where "Use" sends a hook: Create, with the words pinned and the model panel on the right tab. */
export function hookUseHref(hook: { id: string; text: string }, tab: "video" | "slides"): string {
  const params = new URLSearchParams({ hook: hook.text, hookId: hook.id, tab });
  return `/create?${params.toString()}`;
}
