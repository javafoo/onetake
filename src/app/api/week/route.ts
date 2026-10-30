import { randomUUID } from "node:crypto";

import { isUuid } from "@/data/ids";
import { requireUser } from "@/data/users";
import { startJobOnce } from "@/jobs";
import { currentAvatar } from "@/lib/current-avatar";
import { InvalidRequestError, userMessage } from "@/lib/errors";
import { getStorage } from "@/lib/get-storage";
import { mediaPathname } from "@/lib/storage";
import { MAX_NOTES_CHARS } from "@/week/plan";
import { audioExtension, readWeekForm } from "@/week/form";

/* Start a week. The voice note travels in the body (two minutes of speech is
   about a megabyte, well under the platform's 4.5MB), is stored privately
   under her own prefix, and is transcribed by the week's first stage, not
   here: nothing slow runs inside this request. */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireUser();
    const form = readWeekForm(await request.formData());
    if (!isUuid(form.requestId)) throw new InvalidRequestError("This page is out of date. Reload it and try again.");
    const avatar = await currentAvatar(user.id);
    if (!avatar) throw new InvalidRequestError("Set up your avatar first.");

    let audio: { pathname: string; mimeType: string } | undefined;
    if (form.audio) {
      const pathname = mediaPathname(user.id, "voice", randomUUID(), audioExtension(form.audio.type));
      await getStorage().put(pathname, Buffer.from(await form.audio.arrayBuffer()), form.audio.type);
      audio = { pathname, mimeType: form.audio.type };
    }

    const started = await startJobOnce(user, {
      kind: "week",
      requestId: form.requestId,
      avatarId: avatar.id,
      input: { kind: "week", notes: form.notes.slice(0, MAX_NOTES_CHARS), ...(audio ? { audio } : {}), ...(form.goal ? { goal: form.goal } : {}), budget: form.budget },
    });
    return Response.json({ id: started.view.id });
  } catch (error) {
    return Response.json({ error: userMessage("api/week start", error) }, { status: 400 });
  }
}
