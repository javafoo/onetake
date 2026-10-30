"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { buttonClass } from "@/components/ui/button";
import { ResultMessage } from "@/components/ui/message";

/* The picker.

   Photos off a phone are five to twelve megabytes each and the reference set
   only ever needs about 1500 pixels, so every photo is redrawn onto a canvas at
   2048px and re-encoded as a JPEG before it leaves the browser. That is the
   difference between a set that uploads on a train and one that does not.

   They go up one at a time, to the route handler rather than a server action:
   a server action's body is capped at 1MB, and one request per photo means a
   dropped connection costs one photo rather than the whole set. */

const MAX_SIDE = 2048;
const QUALITY = 0.85;

type Item = { key: string; name: string; state: "working" | "done" | "failed"; message?: string };

async function downscale(file: File): Promise<{ body: Blob; type: string; name: string }> {
  /* An iPhone HEIC will not decode here. Rather than guess, the original goes
     up and the server says plainly that it is not a JPEG, PNG or WebP. */
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return { body: file, type: file.type, name: file.name };

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return { body: file, type: file.type, name: file.name };
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
  if (!blob) return { body: file, type: file.type, name: file.name };
  return { body: blob, type: "image/jpeg", name: `${file.name.replace(/\.[^.]+$/, "")}.jpg` };
}

export function PhotoUploader({ remaining, quiet = false }: { remaining: number; quiet?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);

  const mark = (key: string, patch: Partial<Item>) =>
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  async function add(files: FileList | null) {
    if (!files?.length || busy) return;
    const chosen = [...files].slice(0, Math.max(0, remaining));
    const queued: Item[] = chosen.map((file, index) => ({
      key: `${Date.now()}-${index}`,
      name: file.name,
      state: "working",
    }));
    setItems(queued);
    setBusy(true);

    /* One at a time, in the order she picked them. That order breaks ties when
       the curation pass proposes two photos for the same angle, so it has to be
       the order she sees, not whichever request finished first. */
    for (const [index, file] of chosen.entries()) {
      const item = queued[index];
      try {
        const { body, type, name } = await downscale(file);
        const form = new FormData();
        form.append("file", new File([body], name, { type }));
        const response = await fetch("/onboarding/upload", { method: "POST", body: form });
        const result = (await response.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
        if (!response.ok || !result?.ok) {
          mark(item.key, { state: "failed", message: result?.message ?? "That photo would not upload." });
          continue;
        }
        mark(item.key, { state: "done" });
      } catch {
        mark(item.key, { state: "failed", message: "That photo would not upload. Check your connection." });
      }
    }

    setBusy(false);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  const done = items.filter((item) => item.state === "done").length;
  const failed = items.filter((item) => item.state === "failed");
  const full = remaining <= 0;

  return (
    <div>
      <input
        ref={input}
        id="photos"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        disabled={busy || full}
        className="sr-only"
        onChange={(event) => void add(event.target.files)}
      />
      <label
        htmlFor="photos"
        aria-disabled={busy || full}
        className={`${buttonClass(quiet ? "quiet" : "primary", "lg", "w-full")} ${busy || full ? "pointer-events-none opacity-55" : "cursor-pointer"}`}
      >
        {busy
          ? `Adding ${done + 1} of ${items.length}…`
          : full
            ? "That is the most we can use"
            : quiet
              ? "Add more photos"
              : "Choose photos"}
      </label>

      {busy && (
        <p role="status" className="mt-2 text-center text-xs text-muted">
          Shrinking them first, so this works on mobile data.
        </p>
      )}

      {!busy && failed.length > 0 && (
        <div className="mt-3 space-y-2">
          {failed.map((item) => (
            <ResultMessage key={item.key} ok={false}>
              <span className="font-medium">{item.name}</span>: {item.message}
            </ResultMessage>
          ))}
        </div>
      )}
    </div>
  );
}
