import type { Readable } from "node:stream";

/* Browsers abandon video requests constantly (preload, seeking). Readable.toWeb
   keeps pushing into the closed controller and crashes the process, so a Node
   stream is bridged by hand and destroyed the moment the reader goes away. */
export function nodeToWeb(source: Readable): ReadableStream<Uint8Array> {
  let open = true;
  return new ReadableStream({
    start(controller) {
      source.on("data", (chunk) => {
        if (!open) return;
        controller.enqueue(chunk as Uint8Array);
        if ((controller.desiredSize ?? 1) <= 0) source.pause();
      });
      source.on("end", () => {
        if (open) controller.close();
        open = false;
      });
      source.on("error", (error) => {
        if (open) controller.error(error);
        open = false;
      });
    },
    pull() {
      source.resume();
    },
    cancel() {
      open = false;
      source.destroy();
    },
  });
}

export async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}
