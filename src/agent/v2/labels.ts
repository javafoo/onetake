/* The one-line labels the chat shows while a tool runs. Browser-safe and
   pure. A label is all the browser ever learns about a tool call: never its
   arguments, never what it found. */

const LABELS: Record<string, string> = {
  read_brand: "Reading your brand",
  search_library: "Reading your library",
  recent_posts: "Looking at your recent posts",
  write_post: "Writing the post",
  write_hooks: "Writing hooks",
  make_photos: "Setting up the photos",
  make_reel: "Setting up the reel",
  make_carousel: "Starting the carousel",
  words_on_photo: "Putting the words on your photo",
  remember: "Noting that down",
  set_budget: "Noting your budget",
};

export function toolLabel(name: string): string {
  return LABELS[name] ?? "Working on it";
}

/** The kind the chat's job card draws, from the agent run's request kind. */
export function jobCardKind(requestKind: string): string {
  if (requestKind === "photos") return "image";
  return requestKind;
}
