/* The rules of a folder, with nothing behind them: no database, no storage,
   no Node built-ins. The folder bar and the gallery run in the browser and
   need the cap and the "not in a folder" token; `src/data/folders.ts` builds
   its checks on the same rules, so there is one copy of each number. */

/** Enough for a year of weekly shoots; more than this is a search problem, not a folder problem. */
export const MAX_FOLDERS = 50;
export const MAX_FOLDER_NAME = 40;

/** The value a form or a URL sends to mean "not in a folder", where null cannot travel. */
export const NO_FOLDER = "none";

/** A typed name, made storable: trimmed, inner whitespace collapsed. May be empty. */
export const cleanFolderName = (raw: unknown): string => String(raw ?? "").replace(/\s+/g, " ").trim();

/** Why a cleaned name cannot be used, as a sentence, or null when it can. */
export function folderNameProblem(name: string): string | null {
  if (!name) return "Give the folder a name.";
  if (name.length > MAX_FOLDER_NAME) return `Keep the name under ${MAX_FOLDER_NAME} characters.`;
  return null;
}
