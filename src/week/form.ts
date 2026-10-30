import { InvalidRequestError } from "@/lib/errors";

/* The start form, read and checked. Pure, so the rules can be tested without
   a request: what a voice note may be, how much a week may spend. */

export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
export const DEFAULT_WEEK_BUDGET = 12;
export const MAX_WEEK_BUDGET = 30;

const AUDIO_TYPES: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-m4a": "m4a",
};

/** The stored file's extension, from the browser's type with any codec dropped ("audio/webm;codecs=opus"). */
export function audioExtension(type: string): string {
  return AUDIO_TYPES[type.split(";")[0].trim().toLowerCase()] ?? "webm";
}

export type WeekForm = { requestId: string; notes: string; goal?: string; budget: number; audio?: File };

export function readWeekForm(form: FormData): WeekForm {
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const file = form.get("audio");
  const audio = file instanceof File && file.size > 0 ? file : undefined;
  if (audio) {
    if (!AUDIO_TYPES[audio.type.split(";")[0].trim().toLowerCase()]) throw new InvalidRequestError("That voice note is in a format I cannot read. Record it here, or type it.");
    if (audio.size > MAX_AUDIO_BYTES) throw new InvalidRequestError("That voice note is too long. Keep it to about three minutes.");
  }
  const notes = text("notes");
  if (!audio && notes.split(/\s+/).filter(Boolean).length < 15) {
    throw new InvalidRequestError("Tell me a little more about your week: a client, a win, a number, a lesson or a struggle.");
  }
  const asked = Number(text("budget"));
  const budget = Number.isFinite(asked) && asked > 0 ? Math.min(Math.round(asked), MAX_WEEK_BUDGET) : DEFAULT_WEEK_BUDGET;
  const goal = text("goal").slice(0, 200);
  return { requestId: text("requestId"), notes, ...(goal ? { goal } : {}), budget, ...(audio ? { audio } : {}) };
}
