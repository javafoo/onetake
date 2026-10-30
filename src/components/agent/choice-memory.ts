import { CHOICE_MEMORY_KEY, choiceMemory, type ComposerChoice } from "@/agent/composer";

/* Where the browser keeps the composer's last choices (the model panel and
   the text look), so both chats open on what she picked last time. Read as
   an external store, so the server's page and the browser's first paint
   agree. A private window keeps nothing, and that is fine. */

export function readChoice(): string | null {
  try {
    return window.localStorage.getItem(CHOICE_MEMORY_KEY);
  } catch {
    return null;
  }
}

// Nothing else writes the key while the page is open, so there is nothing to listen to.
export const subscribeChoice = () => () => {};

export function writeChoice(choice: ComposerChoice): void {
  try {
    window.localStorage.setItem(CHOICE_MEMORY_KEY, choiceMemory(choice));
  } catch {
    // A private window: the choice still holds for this visit.
  }
}
