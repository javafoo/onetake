"use client";

import { useState } from "react";

import { Field, Select } from "@/components/ui";
import { LANGUAGE_CODES, languageLabel, normaliseLanguage, voiceNote } from "@/content/languages";

/* The content language, on the first setup screen and on the Brand page. A
   plain select, with one line under it when talking reels are not known to
   work in the chosen language. The server checks the value again. */

export function LanguageSelect({ defaultValue }: { defaultValue?: string }) {
  const [code, setCode] = useState(normaliseLanguage(defaultValue));
  const note = voiceNote(code);
  return (
    <Field label="What language does she post in?" hint="Hooks, captions, slides and what she says in a talking reel are written in it. The app itself stays in English.">
      <Select name="language" value={code} onChange={(event) => setCode(normaliseLanguage(event.target.value))}>
        {LANGUAGE_CODES.map((option) => (
          <option key={option} value={option}>
            {languageLabel(option)}
          </option>
        ))}
      </Select>
      {note && (
        <span className="mt-2 block text-xs text-muted" aria-live="polite">
          {note}
        </span>
      )}
    </Field>
  );
}
