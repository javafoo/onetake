import { auth } from "@clerk/nextjs/server";

import { zip } from "@/carousel/zip";
import { getCarousel } from "@/data/carousels";
import { readMedia } from "@/data/media";

/* Every slide in one download, in swipe order, with the caption beside them.

   Instagram wants the files one at a time in the right order, so the names are
   01.png, 02.png and so on: whatever the phone's file picker sorts by, they
   come out in the order she wrote them. The caption rides along as a text file
   because the other half of posting a set is pasting it. */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_request: Request, context: RouteContext<"/carousels/[id]/zip">): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return new Response("Not signed in", { status: 401 });

  const { id } = await context.params;
  const set = await getCarousel(userId, id);
  if (!set || set.slides.length === 0) return new Response("Not found", { status: 404 });

  const entries = [];
  for (const slide of set.slides) {
    entries.push({ name: `${String(slide.index + 1).padStart(2, "0")}.png`, data: await readMedia(userId, slide.id) });
  }
  const caption = [set.draft.caption, set.draft.cta].filter(Boolean).join("\n\n");
  if (caption) entries.push({ name: "caption.txt", data: Buffer.from(`${caption}\n`, "utf8") });

  const file = zip(entries, set.draft.updatedAt);
  const name = `${set.draft.format === "story" ? "story" : "carousel"}-${set.draft.id.slice(0, 8)}.zip`;
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(file.length),
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
