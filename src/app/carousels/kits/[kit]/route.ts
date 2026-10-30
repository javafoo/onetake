import { auth } from "@clerk/nextjs/server";

import { resolveKit, type Palette, type PaletteKey } from "@/carousel/kits";
import { kitOwnerSlug } from "@/carousel/owners";
import { renderSampleTile } from "@/carousel/render";

/* The sample tile behind the style picker.

   It is a real slide, drawn by the real renderer, because the whole point of
   the tile is to show what the renderer will do with a title: the face, the way
   an emphasised word is set apart, the accent line, the paper and its grain. A
   CSS mock-up would be a promise we might not keep.

   It is also where the private kit is enforced for reading: `resolveKit`
   refuses a kit this account does not own, so a stranger who guesses the URL
   gets a 404 rather than a look at it. Colour overrides ride in the query, so
   retuning the palette in the form redraws the tile with no state on the
   server and no model call. */

export const dynamic = "force-dynamic";

const PALETTE_KEYS: PaletteKey[] = ["paper", "panel", "ink", "accent", "muted", "contrast"];

function paletteFrom(url: URL): Partial<Palette> | undefined {
  const palette: Partial<Palette> = {};
  for (const key of PALETTE_KEYS) {
    const raw = url.searchParams.get(key);
    const value = raw?.startsWith("#") ? raw : raw ? `#${raw}` : "";
    if (/^#[0-9a-fA-F]{6}$/.test(value)) palette[key] = value.toLowerCase();
  }
  return Object.keys(palette).length ? palette : undefined;
}

export async function GET(request: Request, context: RouteContext<"/carousels/kits/[kit]">): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return new Response("Not signed in", { status: 401 });

  const { kit: kitId } = await context.params;
  let kit;
  try {
    kit = resolveKit(kitId, { palette: paletteFrom(new URL(request.url)), profileSlug: kitOwnerSlug(userId) });
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const png = await renderSampleTile(kit, 440);
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(png.length),
      // The same kit and palette always draw the same tile, and it is nobody
      // else's business which kits this account can see.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
