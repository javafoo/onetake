import { redirect } from "next/navigation";

import { flowStateFor } from "@/data/onboarding";
import { requireUser } from "@/data/users";

import { resumePath } from "./flow";

export const dynamic = "force-dynamic";

/** The address to bookmark. It holds no screen of its own: it works out what is
    still missing and opens that, so "carry on where I left off" is one URL. */
export default async function ResumeSetup() {
  const user = await requireUser();
  const { flow } = await flowStateFor(user.id);
  redirect(resumePath(flow));
}
