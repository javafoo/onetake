/* Downloads of her media. Pure and client-safe: the tiles build the link, the
   media route builds the filename. Every download goes through
   `/api/media/[id]`, which looks the id up as the signed-in user's first. */

/** The link that saves a file rather than opening it. */
export function downloadHref(mediaId: string): string {
  return `/api/media/${encodeURIComponent(mediaId)}?download=1`;
}

/** True when a media request asks for the file to be saved. */
export function wantsDownload(url: string): boolean {
  return new URL(url, "http://local").searchParams.get("download") === "1";
}

const WORD: Record<string, string> = { image: "photo", upload: "photo", reference: "photo", clip: "clip", reel: "reel", slide: "slide" };

/**
 * The name a download is saved under: the name she uploaded it as, or what it
 * is and a short id. Only letters, digits, dashes and underscores survive, so
 * a crafted upload name cannot steer the save or break the header.
 */
export function downloadFilename(media: { id: string; kind: string; extension: string; originalName?: unknown }): string {
  const uploaded = typeof media.originalName === "string" ? media.originalName.replace(/\.[^.]*$/, "") : "";
  const clean = uploaded
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const stem = clean || `${WORD[media.kind] ?? "file"}-${media.id.slice(0, 8)}`;
  return `${stem}.${media.extension}`;
}

/** The Content-Disposition value for a media response. */
export function mediaDisposition(download: boolean, filename: string): string {
  return `${download ? "attachment" : "inline"}; filename="${filename}"`;
}
