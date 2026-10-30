import { KeywordColorPicker } from "@/components/brand/keyword-color-picker";
import { Field, Input } from "@/components/ui";
import type { BrandProfile } from "@/content/hooks";
import { MAX_OFFERS, offersOf } from "@/content/offers";

/* The Brand page's "What she sells": the default offer and keyword, up to
   four more offers behind a disclosure, the link and whether it pays a
   commission (both for stories), and the keyword colour. Plain form fields;
   `saveBrandAction` reads and checks them. */

export function OfferFields({ profile }: { profile: BrandProfile }) {
  const extras = offersOf(profile).slice(1);
  return (
    <>
      <div className="grid gap-6 sm:grid-cols-[1fr_11rem]">
        <Field label="Offer" hint="The one thing the link in bio sells or gives away. This is the default.">
          <Input name="offer" defaultValue={profile.offer} placeholder="A free 15-minute consult" />
        </Field>
        <Field label="Comment keyword" hint="People comment this word to get it.">
          <Input name="keyword" defaultValue={profile.keyword} placeholder="AVATAR" className="uppercase" />
        </Field>
      </div>
      <details className="group rounded-xl border border-line p-4" open={extras.length > 0}>
        <summary className="cursor-pointer text-sm font-medium text-ink">
          {extras.length ? `Other offers (${extras.length})` : "Add another offer"}
        </summary>
        <p className="mt-1 text-sm text-muted">Up to {MAX_OFFERS - 1} more, each with its own keyword. Clear both boxes to remove one.</p>
        <div className="mt-4 space-y-4">
          {Array.from({ length: MAX_OFFERS - 1 }, (_, index) => (
            <div key={index} className="grid gap-4 sm:grid-cols-[1fr_11rem]">
              <Field label={`Offer ${index + 2}`}>
                <Input name={`offer${index + 2}`} defaultValue={extras[index]?.offer ?? ""} placeholder={index === extras.length ? "1:1 coaching, 4 weeks" : undefined} />
              </Field>
              <Field label="Keyword">
                <Input name={`keyword${index + 2}`} defaultValue={extras[index]?.keyword ?? ""} placeholder={index === extras.length ? "COACH" : undefined} className="uppercase" />
              </Field>
            </div>
          ))}
        </div>
      </details>
      <div className="grid gap-6 sm:grid-cols-[1fr_14rem] sm:items-start">
        <Field label="Link" hint="Where a link sticker in your stories points. Optional: without it, stories point to your comment keyword.">
          <Input name="link" type="url" inputMode="url" defaultValue={profile.link ?? ""} placeholder="https://" />
        </Field>
        <label className="flex items-start gap-2 pt-1 text-sm sm:pt-7">
          <input type="checkbox" name="affiliate" value="yes" defaultChecked={profile.affiliate === true} className="mt-0.5 size-4 shrink-0 accent-accent" />
          <span>
            It pays me a commission
            <span className="block text-xs text-muted">A story frame with the link says it is an affiliate link.</span>
          </span>
        </label>
      </div>
      <KeywordColorPicker defaultValue={profile.keywordColor} keyword={profile.keyword} />
    </>
  );
}
