/* The Uploads tab and "Copy to another avatar". Pure and client-safe: the
   page, the gallery and the server action share these rules.

   An upload is a media row she added from her device (`meta.source =
   "upload"`), a photo or a clip. A photo is either of her or of a place or a
   thing (`meta.subject = "scene"`, see src/carousel/match.ts); that mark is
   what the generators read, so it is also what the tab groups by. Nothing
   here is stored: the group is worked out from the row every time.

   A copy is a new row for the other avatar with its own stored object, so
   deleting one never breaks the other. It remembers the upload it came from
   (`meta.copiedFrom`, always the first upload in the chain), which is how a
   second press, or a copy back, is recognised and skipped. */

export type UploadGroup = "places" | "me" | "clips";

/** The order the tab shows the groups in: places and things first, since they are what gets shared. */
export const UPLOAD_GROUPS: readonly UploadGroup[] = ["places", "me", "clips"];

export const UPLOAD_GROUP_LABEL: Record<UploadGroup, string> = {
  places: "Places and things",
  me: "Photos of you",
  clips: "Clips",
};

export const UPLOAD_GROUP_EMPTY: Record<UploadGroup | "all", { title: string; body: string }> = {
  all: {
    title: "Nothing uploaded yet",
    body: "Photos and clips you add with “Add your own” on the Photos tab land here, of you or of places and things.",
  },
  places: {
    title: "No places or things yet",
    body: "When you add photos, choose “Places and things” for a desk, a coffee or a view. You can also open any photo you added and change what is in it.",
  },
  me: {
    title: "No photos of you yet",
    body: "Photos of you that you add from your phone land here.",
  },
  clips: {
    title: "No clips yet",
    body: "Clips you add from your phone land here.",
  },
};

type Row = { id: string; kind: string; avatarId: string | null; meta: unknown };

function metaOf(row: { meta: unknown }): Record<string, unknown> {
  return typeof row.meta === "object" && row.meta !== null ? (row.meta as Record<string, unknown>) : {};
}

/** Whether she added this herself, rather than the app making it. */
export function isUpload(row: { meta: unknown }): boolean {
  return metaOf(row).source === "upload";
}

/** Which group an upload is in, or null for anything that is not an upload photo or clip. */
export function uploadGroup(row: { kind: string; meta: unknown }): UploadGroup | null {
  if (!isUpload(row)) return null;
  if (row.kind === "clip") return "clips";
  if (row.kind === "image") return metaOf(row).subject === "scene" ? "places" : "me";
  return null;
}

/** The group a URL asked for, or null for all of them. Anything unknown is all. */
export function uploadGroupFrom(value: unknown): UploadGroup | null {
  return UPLOAD_GROUPS.find((group) => group === value) ?? null;
}

/** The avatar a URL asked for, when it is one of hers; otherwise every avatar. */
export function avatarFilterFrom(value: unknown, avatars: { id: string }[]): string | null {
  return typeof value === "string" && avatars.some((avatar) => avatar.id === value) ? value : null;
}

/**
 * The uploads one view shows, and the counts for its chips. The counts are
 * taken after the avatar filter and before the group filter, so a chip says
 * how many it opens.
 */
export function uploadsView<T extends Row>(
  rows: T[],
  view: { group: UploadGroup | null; avatarId: string | null },
): { items: Record<UploadGroup, T[]>; counts: Record<UploadGroup | "all", number> } {
  const items: Record<UploadGroup, T[]> = { places: [], me: [], clips: [] };
  for (const row of rows) {
    const group = uploadGroup(row);
    if (!group) continue;
    // A row from before rows carried an avatar is every avatar's, as on every other shelf.
    if (view.avatarId && row.avatarId && row.avatarId !== view.avatarId) continue;
    items[group].push(row);
  }
  const counts = { places: items.places.length, me: items.me.length, clips: items.clips.length, all: 0 };
  counts.all = counts.places + counts.me + counts.clips;
  if (view.group) {
    for (const group of UPLOAD_GROUPS) if (group !== view.group) items[group] = [];
  }
  return { items, counts };
}

/** `?group=` and `?avatar=` for the tab, leaving out what is the default. */
export function uploadsHref(view: { group?: UploadGroup | null; avatarId?: string | null }): string {
  const params = new URLSearchParams();
  if (view.group) params.set("group", view.group);
  if (view.avatarId) params.set("avatar", view.avatarId);
  const query = params.toString();
  return query ? `/library/uploads?${query}` : "/library/uploads";
}

/* --- copying to another avatar ------------------------------------------ */

/** The most one press copies. A photo is under a megabyte, a clip up to 60MB, and the copy runs inside the request. */
export const MAX_COPY_ITEMS = 20;
export const MAX_COPY_BYTES = 150 * 1024 * 1024;

/**
 * Whether this upload may be copied to another avatar. A photo of her is not:
 * it would become the other avatar's photo, and one avatar's face in another's
 * carousel is what the avatar scoping exists to prevent. Places and things and
 * clips may.
 */
export function canCopy(row: { kind: string; meta: unknown }): boolean {
  const group = uploadGroup(row);
  return group === "places" || group === "clips";
}

/** The first upload a row was copied from, or the row itself. */
export function copyRoot(row: { id: string; meta: unknown }): string {
  const from = metaOf(row).copiedFrom;
  return typeof from === "string" && from ? from : row.id;
}

/**
 * The meta the copy is written with: everything the upload knew about itself
 * (what is in it, its description, its safety verdict, when the rights box
 * was ticked), less the heart, which is a choice made on one avatar's shelf.
 */
export function copiedMeta(source: { id: string; meta: unknown }, now: Date): Record<string, unknown> {
  const rest = { ...metaOf(source) };
  delete rest.favorite;
  return { ...rest, source: "upload", copiedFrom: copyRoot(source), copiedAt: now.toISOString() };
}

export type CopyPlan<T> = {
  /** What will be copied, in the order asked. */
  copy: T[];
  /** Already on the target avatar: the upload itself, or an earlier copy of it. */
  already: number;
  /** Photos of her, or rows that are not uploads. */
  refused: number;
  /** Over the size of one press; she can copy them in another go. */
  later: number;
};

/**
 * Decides what one press copies. `onTarget` is the copy roots already on the
 * target avatar, which is what makes a second press, a retry or a copy back to
 * where it came from do nothing.
 */
export function planCopies<T extends Row & { bytes: number }>(
  sources: T[],
  targetAvatarId: string,
  onTarget: ReadonlySet<string>,
  limits: { items: number; bytes: number } = { items: MAX_COPY_ITEMS, bytes: MAX_COPY_BYTES },
): CopyPlan<T> {
  const plan: CopyPlan<T> = { copy: [], already: 0, refused: 0, later: 0 };
  const seen = new Set<string>();
  let bytes = 0;
  for (const row of sources) {
    const root = copyRoot(row);
    if (!canCopy(row)) {
      plan.refused += 1;
      continue;
    }
    if (row.avatarId === targetAvatarId || onTarget.has(root) || seen.has(root)) {
      plan.already += 1;
      continue;
    }
    // The first one always goes, however large, so no single clip can never be copied.
    if (plan.copy.length >= limits.items || (plan.copy.length > 0 && bytes + row.bytes > limits.bytes)) {
      plan.later += 1;
      continue;
    }
    seen.add(root);
    bytes += row.bytes;
    plan.copy.push(row);
  }
  return plan;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What happened, in one or two short sentences. */
export function copyResultMessage(
  outcome: { copied: number; already: number; refused: number; later: number; full: boolean },
  name: string,
): string {
  const parts: string[] = [];
  if (outcome.copied > 0) parts.push(`Copied ${plural(outcome.copied, "item", "items")} to ${name}.`);
  if (outcome.already > 0) parts.push(`${plural(outcome.already, "was", "were")} already there.`);
  if (outcome.refused > 0) parts.push(`${plural(outcome.refused, "photo of you stays", "photos of you stay")} where ${outcome.refused === 1 ? "it is" : "they are"}.`);
  if (outcome.full) parts.push("There is no room for more uploads. Delete some you added to copy the rest.");
  else if (outcome.later > 0) parts.push(`Select the other ${outcome.later} and copy again.`);
  return parts.join(" ") || `Nothing to copy to ${name}.`;
}

/** The line under the Copy buttons, said before one is pressed. `name` is the one avatar offered, or null for several. */
export function copyNote(group: UploadGroup | null, name: string | null, cap: number): string {
  const who = name ?? "The avatar you pick";
  const free = `Free. The copy counts as one of your ${cap} uploads.`;
  if (group === "clips") return `${who} can use it in reels too. Copy only footage that does not show another avatar’s face. ${free}`;
  return `${who} can use it in carousels too. ${free}`;
}

/** Why a photo of her has no Copy button, and the way round it. */
export function copyRefusalNote(from: string): string {
  return `A photo of ${from} stays with ${from}, so no other avatar is shown with this face. If nobody is in it, set “What is in it” to a place or thing first.`;
}
