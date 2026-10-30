/* The app tells the model what happened in a chat with notes it reads as its
   own earlier lines: "[Offered: …]" when an offer is made, "[Started: …]" when
   her tap starts the work (`thread.ts`). Left alone, the model copies the
   format into its replies, and what it writes is invented: a start before she
   tapped, a job id that does not exist. The app is the only author of those
   notes, so any the model writes at the start of a reply is dropped, both as
   it streams and as it is stored. Pure. */

const NOTE = /^\s*\[(?:Offered|Started):[^\]]*\]\s*/;
const MARKERS = ["[Offered:", "[Started:"];
/** A note is a line, not an essay: past this the buffered text is plainly not one. */
const MAX_HELD = 600;

/** `text` without the notes at its start. */
export function stripNotes(text: string): string {
  let rest = text;
  for (let match = NOTE.exec(rest); match; match = NOTE.exec(rest)) rest = rest.slice(match[0].length);
  return rest;
}

/** Whether `text` could still turn out to start a note, given more text. */
function mayBecomeNote(text: string): boolean {
  const start = text.trimStart();
  if (!start) return true;
  if (start.length >= MAX_HELD) return false;
  return MARKERS.some((marker) => marker.startsWith(start) || (start.startsWith(marker) && !start.includes("]")));
}

/** A streaming filter: pieces in, the same pieces out minus leading notes. Holds back only text that might still become a note. */
export function createNoteFilter(out: (piece: string) => void): { push: (piece: string) => void; end: () => void } {
  let held = "";
  let passing = false;
  return {
    push(piece) {
      if (passing) return out(piece);
      held = stripNotes(held + piece);
      if (mayBecomeNote(held)) return;
      passing = true;
      if (held) out(held);
      held = "";
    },
    end() {
      if (!passing && held) out(held);
      held = "";
      passing = true;
    },
  };
}
