import { ROLE_HELP, ROLE_LABEL, type RoleProposal } from "@/app/onboarding/roles";
import { MediaChoice } from "@/components/ui";
import type { ReferenceRole } from "@/data/avatars";
import { mediaUrl } from "@/data/media";

/* One row per part, every photo in the row, the proposed one already ringed.

   A dropdown per photo would be fewer pixels and much worse: she is comparing
   pictures, so the pictures have to be side by side and changing her mind has
   to be one tap. The rows scroll sideways on a phone, which is the one gesture
   a grid of five rows can afford. */

export function RolePicker({
  role,
  photos,
  selected,
  notes,
}: {
  role: ReferenceRole;
  photos: { id: string; index: number }[];
  selected?: string;
  notes: Map<string, RoleProposal>;
}) {
  /* The chosen photo leads. The row scrolls sideways, so a photo picked from
     the middle of fifteen would otherwise be off the right of a phone screen
     and the row would look empty. */
  const ordered = [...photos].sort((a, b) => Number(b.id === selected) - Number(a.id === selected));

  const none = (
    <label className="relative block shrink-0 cursor-pointer snap-start">
      <input type="radio" name={role} value="" defaultChecked={!selected} className="peer sr-only" />
      <span className="sr-only">No photo for {ROLE_LABEL[role].toLowerCase()}</span>
      <span className="grid aspect-[3/4] w-[4.5rem] place-items-center rounded-lg border border-dashed border-line-strong bg-surface/60 px-2 text-center text-2xs font-medium text-muted peer-checked:border-solid peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
        None
      </span>
    </label>
  );

  return (
    /* A fieldset defaults to min-inline-size: min-content, which a wide
       scrolling row then stretches past the edge of the page. */
    <fieldset className="min-w-0">
      <legend className="text-sm font-medium text-ink">
        {ROLE_LABEL[role]}
        {role === "front" && <span className="ml-2 text-xs font-normal text-accent">needed</span>}
      </legend>
      <p className="mt-0.5 max-w-prose text-xs text-muted">{ROLE_HELP[role]}</p>

      <div className="no-scrollbar mt-3 flex snap-x gap-2 overflow-x-auto pb-1">
        {/* Whatever is checked comes first, so the answer is always in view. */}
        {!selected && none}
        {ordered.map((photo) => (
          <div key={photo.id} className="w-[4.5rem] shrink-0 snap-start">
            <MediaChoice
              name={role}
              value={photo.id}
              kind="image"
              src={mediaUrl(photo.id)}
              ratio="3:4"
              defaultChecked={selected === photo.id}
              label={`Photo ${photo.index + 1}${notes.get(photo.id)?.note ? `: ${notes.get(photo.id)!.note}` : ""} as ${ROLE_LABEL[role].toLowerCase()}`}
            />
          </div>
        ))}

        {selected && none}
      </div>
    </fieldset>
  );
}
