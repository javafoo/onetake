/* Where the two tabs live and how a folder rides along in the URL. Shared by
   the server pages and the client components, so it holds no React. */

export type LibraryTab = "photos" | "videos";

export const LIBRARY_PATH: Record<LibraryTab, string> = {
  photos: "/library",
  videos: "/library/videos",
};

/**
 * `folder` is the value straight from the URL: a folder id, "none" for the
 * unfiled view, or nothing for everything. `extra` adds other parameters.
 */
export function libraryHref(tab: LibraryTab, folder?: string | null, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  if (folder) params.set("folder", folder);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  const query = params.toString();
  return query ? `${LIBRARY_PATH[tab]}?${query}` : LIBRARY_PATH[tab];
}
