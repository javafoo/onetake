import { auth } from "@clerk/nextjs/server";

import { getMedia } from "@/data/media";
import { wantsDownload } from "@/lib/download";
import { serveMedia } from "@/lib/serve-media";

/* How media reaches her browser. The id is looked up scoped to the signed-in
   user, so someone else's id is a 404 rather than a redirect to their bytes, and
   nothing is ever served by storage URL. */

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return new Response("Not signed in", { status: 401 });

  const { id } = await context.params;
  const row = await getMedia(userId, id);
  if (!row) return new Response("Not found", { status: 404 });

  return serveMedia(request, row, wantsDownload(request.url));
}
