import type { InlineImage } from "@/ai/gemini";
import { InvalidRequestError } from "@/lib/errors";
import { sniffImageType } from "@/lib/image-bytes";

import { MAX_ATTACHMENTS } from "./plan";

/* Screenshots pasted into a message box. Shrunk in the browser, sent as data
   URLs, decoded and sniffed here (a name is not a type), screened like any
   upload, shown to the model once and never stored. Shared by the first chat's
   action and the agent's turn route. */

const MAX_ATTACHMENT_BYTES = 1_200_000;

export function decodeScreenshots(raw: unknown): InlineImage[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new InvalidRequestError("The screenshots could not be read. Paste them again.");
  if (raw.length > MAX_ATTACHMENTS) throw new InvalidRequestError(`Up to ${MAX_ATTACHMENTS} screenshots per message.`);
  return raw.map((item) => {
    const match = typeof item === "string" ? /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(item) : null;
    if (!match) throw new InvalidRequestError("Only JPEG, PNG or WebP screenshots can be attached.");
    const data = Buffer.from(match[2], "base64");
    if (data.length === 0 || data.length > MAX_ATTACHMENT_BYTES) throw new InvalidRequestError("A screenshot is too large. Try a smaller one.");
    const type = sniffImageType(data);
    if (!type) throw new InvalidRequestError("One of the screenshots is not an image.");
    return { mimeType: type, data };
  });
}
