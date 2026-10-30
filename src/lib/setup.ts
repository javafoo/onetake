/* The four setup steps, in one place. The Overview lists them in full, the
   sidebar and the phone's bottom bar mark them with dots, and the
   banner that says "you are set up" fires when all four are done. Each view
   used to compute its own version of "done", which is how they drift. */

export type SetupCounts = {
  profileComplete: boolean;
  keyword?: string | null;
  references: number;
  clips: number;
  /** Photos in the library; only the Overview has counted them. */
  images?: number;
  drafts: number;
  /** Drafts with a finished reel. */
  assembled: number;
};

export type SetupStep = {
  href: string;
  title: string;
  body: string;
  todo: string;
  done: boolean;
  status: string;
};

export function setupSteps(c: SetupCounts): SetupStep[] {
  const photos = c.images === undefined ? "" : ` · ${c.images} photos`;
  return [
    {
      href: "/brand",
      title: "Brand",
      body: "Who you talk to, what you sell, the word people comment.",
      todo: "Tell the writer who she is talking to",
      done: c.profileComplete,
      status: c.profileComplete ? `Keyword ${c.keyword ?? ""}`.trim() : "Not set up",
    },
    {
      href: "/avatar",
      title: "Avatar",
      body: "The reference photos that keep her face the same everywhere.",
      todo: "Add real photos so her face stays hers",
      done: c.references > 0,
      status: c.references ? `${c.references} reference photos` : "No photos yet",
    },
    {
      href: "/library",
      title: "Library",
      body: "Photos and clips you reuse. One clip carries many hooks.",
      todo: "Make the first clip you can post with",
      done: c.clips > 0,
      status: `${c.clips} clips${photos}`,
    },
    {
      href: "/create",
      title: "Create",
      body: "Tell the agent what you want posted. It writes it and makes the photos, reels and carousels.",
      todo: "Ask the agent for your first post",
      done: c.assembled > 0,
      status: `${c.drafts} drafts · ${c.assembled} reels`,
    },
  ];
}

/** All four done. From here the numbers and dots have nothing left to say. */
export const setupComplete = (steps: SetupStep[]): boolean => steps.every((step) => step.done);
