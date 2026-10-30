import type { ReferenceRole } from "@/data/avatars";

/* Which photo plays which part.

   A vision model looks at the uploaded photos and proposes a role for each one.
   Its proposals are a suggestion and nothing more: the rules below decide what
   is actually stored, and the user can overrule the result by tapping. Keeping
   the rules here, away from the model call, is what makes them testable — and a
   model that hands back the same photo for five roles is a normal Tuesday.

   The order of the roles is the order the references are sent to the image
   model, and the first reference sets the look, so `position` is part of the
   contract with src/data/avatars.ts, not decoration. */

export const ROLE_ORDER: readonly ReferenceRole[] = [
  "front",
  "three_quarter",
  "profile",
  "full_body",
  "expression",
];

export const ROLE_LABEL: Record<ReferenceRole, string> = {
  front: "Looking at the camera",
  three_quarter: "Turned slightly away",
  profile: "Side on",
  full_body: "Head to toe",
  expression: "Showing some feeling",
};

/** The short form, for a chip on a photo. */
export const ROLE_SHORT: Record<ReferenceRole, string> = {
  front: "Front",
  three_quarter: "Three-quarter",
  profile: "Side",
  full_body: "Full body",
  expression: "Expression",
};

export const ROLE_HELP: Record<ReferenceRole, string> = {
  front: "Her face square to the camera. This one matters most: it sets the look.",
  three_quarter: "Head turned part way, so the shape of her face reads.",
  profile: "All the way round to the side.",
  full_body: "Standing, head to toe, so her build and height are fixed.",
  expression: "Laughing, talking, mid-sentence. Anything but a straight face.",
};

export function isRole(value: string): value is ReferenceRole {
  return (ROLE_ORDER as readonly string[]).includes(value);
}

/** What the model hands back, one per photo, before anything has checked it:
    the role is whatever string came out, and the id may be nonsense. */
export type RawProposal = {
  mediaId: string;
  role: string | null;
  /** 0 to 1. A model that gives no number is treated as half sure. */
  confidence: number;
  /** One short line the user reads beside the photo. */
  note: string;
};

/** The same thing once it has been through `cleanProposals`. */
export type RoleProposal = RawProposal & { role: ReferenceRole | null };

export type RoleAssignment = { mediaId: string; role: ReferenceRole; position: number };

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}

/** Keeps one proposal per photo, drops ids that are not this avatar's, and
    scores anything odd as half sure rather than throwing the batch away. */
export function cleanProposals(proposals: RawProposal[], mediaIds: string[]): RoleProposal[] {
  const allowed = new Set(mediaIds);
  const seen = new Set<string>();
  const out: RoleProposal[] = [];
  for (const proposal of proposals) {
    if (!allowed.has(proposal.mediaId) || seen.has(proposal.mediaId)) continue;
    seen.add(proposal.mediaId);
    out.push({
      mediaId: proposal.mediaId,
      role: proposal.role && isRole(proposal.role) ? proposal.role : null,
      confidence: clamp(Number(proposal.confidence)),
      note: String(proposal.note ?? "").trim(),
    });
  }
  return out;
}

/** One photo per role, one role per photo, best guess wins, and the front slot
    is filled whatever happens: nothing downstream can run without a reference,
    and an unfilled front is the difference between an avatar and an error. */
export function assignRoles(proposals: RawProposal[], mediaIds: string[]): RoleAssignment[] {
  const clean = cleanProposals(proposals, mediaIds);
  const order = new Map(mediaIds.map((id, index) => [id, index]));
  const taken = new Set<string>();
  const chosen = new Map<ReferenceRole, string>();

  /* Ties are broken by upload order rather than by whichever way the model
     happened to list them, so the same photos always give the same set. */
  const better = (a: RoleProposal, b: RoleProposal) =>
    b.confidence - a.confidence || (order.get(a.mediaId) ?? 0) - (order.get(b.mediaId) ?? 0);

  for (const role of ROLE_ORDER) {
    const candidate = clean
      .filter((item) => item.role === role && !taken.has(item.mediaId))
      .sort(better)[0];
    if (!candidate) continue;
    chosen.set(role, candidate.mediaId);
    taken.add(candidate.mediaId);
  }

  if (!chosen.has("front")) {
    const fallback =
      clean.filter((item) => !taken.has(item.mediaId)).sort(better)[0]?.mediaId ??
      mediaIds.find((id) => !taken.has(id));
    if (fallback) {
      chosen.set("front", fallback);
      taken.add(fallback);
    }
  }

  return ROLE_ORDER.filter((role) => chosen.has(role)).map((role, position) => ({
    mediaId: chosen.get(role)!,
    role,
    position,
  }));
}

/** Reads the form the user submits on the curation screen. Blank means "no
    photo for this role", and a photo picked twice keeps its first role so the
    set can never contain the same picture under two names. */
export function assignmentsFromForm(picked: Partial<Record<ReferenceRole, string>>, mediaIds: string[]): RoleAssignment[] {
  const allowed = new Set(mediaIds);
  const taken = new Set<string>();
  const out: RoleAssignment[] = [];
  for (const role of ROLE_ORDER) {
    const mediaId = picked[role];
    if (!mediaId || !allowed.has(mediaId) || taken.has(mediaId)) continue;
    taken.add(mediaId);
    out.push({ mediaId, role, position: out.length });
  }
  return out;
}
