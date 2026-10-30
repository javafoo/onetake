import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { generateText } from "../ai/text";

/* The brief is the creator's one-page view of who the avatar is: story, audience,
   offer, voice, positioning, proof. It is distilled from their own documents, every
   line names the document it came from, and places where documents disagree are
   listed rather than smoothed over. */

export type Sourced = { text: string; source: string };
export type Conflict = { topic: string; versions: Sourced[]; newest: string };

export type Brief = {
  builtAt: string;
  sources: { path: string; name: string; modified: string }[];
  oneLiner: Sourced;
  audience: Sourced[];
  problem: Sourced[];
  offer: Sourced[];
  story: { before: Sourced; turn: Sourced; after: Sourced };
  pointOfView: Sourced[];
  voiceIs: Sourced[];
  voiceIsNot: Sourced[];
  proof: Sourced[];
  positioningLines: Sourced[];
  conflicts: Conflict[];
};

const sourced = { type: "object", properties: { text: { type: "string" }, source: { type: "string" } }, required: ["text", "source"] };
const list = { type: "array", items: sourced };

const SCHEMA = {
  type: "object",
  properties: {
    oneLiner: sourced, audience: list, problem: list, offer: list,
    story: { type: "object", properties: { before: sourced, turn: sourced, after: sourced }, required: ["before", "turn", "after"] },
    pointOfView: list, voiceIs: list, voiceIsNot: list, proof: list, positioningLines: list,
    conflicts: {
      type: "array",
      items: {
        type: "object",
        properties: { topic: { type: "string" }, versions: list, newest: { type: "string" } },
        required: ["topic", "versions", "newest"],
      },
    },
  },
  required: ["oneLiner", "audience", "problem", "offer", "story", "pointOfView", "voiceIs", "voiceIsNot", "proof", "positioningLines", "conflicts"],
};

const briefDir = (root: string, slug: string) => join(root, "brief", slug);

export async function getSources(root: string, slug: string): Promise<string[]> {
  try {
    return JSON.parse(await readFile(join(briefDir(root, slug), "sources.json"), "utf8")) as string[];
  } catch {
    return [];
  }
}

export async function loadBrief(root: string, slug: string): Promise<Brief | null> {
  try {
    return JSON.parse(await readFile(join(briefDir(root, slug), "brief.json"), "utf8")) as Brief;
  } catch {
    return null;
  }
}

/** Documents edited after the brief was built, so the page can say it is stale. */
export async function staleSources(brief: Brief): Promise<string[]> {
  const changed: string[] = [];
  for (const source of brief.sources) {
    try {
      if ((await stat(source.path)).mtime.toISOString() > brief.builtAt) changed.push(source.name);
    } catch {
      changed.push(`${source.name} (missing)`);
    }
  }
  return changed;
}

/** The file-backed wrapper the CLI script still uses against `data/`. */
export async function buildBrief(root: string, slug: string): Promise<Brief> {
  const brief = await buildBriefFrom(await getSources(root, slug));
  await mkdir(briefDir(root, slug), { recursive: true });
  await writeFile(join(briefDir(root, slug), "brief.json"), JSON.stringify(brief, null, 2) + "\n");
  return brief;
}

/** The brief itself; the caller stores it. The app keeps it on the brand profile
    row, the CLI writes it beside the documents it came from. */
export async function buildBriefFrom(paths: string[]): Promise<Brief> {
  if (paths.length === 0) throw new Error("No source documents are set for this brief.");

  const docs = await Promise.all(
    paths.map(async (path) => ({
      path, name: basename(path), modified: (await stat(path)).mtime.toISOString(), text: await readFile(path, "utf8"),
    })),
  );

  const result = await generateText<Omit<Brief, "builtAt" | "sources">>({
    schema: SCHEMA,
    system:
      "You distil a creator's own brand documents into a one-page brief they can scan in a minute. " +
      "Use only what the documents say, in their wording where possible. Never add, improve or infer facts. " +
      "Every item carries `source`: the exact file name it came from.",
    prompt:
      "Build the brief from these documents. Keep every item to one or two short sentences. Up to five items per list.\n" +
      "When documents disagree (audience, follower counts, income, timelines, offer, one-liner), do NOT pick a winner inside the lists: " +
      "use the most recently modified document for the list, and record the disagreement in `conflicts` with each version, its file name, " +
      "and `newest` set to the file name of the most recently modified version. Compare numbers carefully.\n\n" +
      docs.map((doc) => `===== FILE: ${doc.name} | last modified ${doc.modified.slice(0, 10)} =====\n${doc.text}`).join("\n\n"),
  });

  return {
    builtAt: new Date().toISOString(),
    sources: docs.map(({ path, name, modified }) => ({ path, name, modified })),
    ...result,
  };
}
