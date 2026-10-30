"use client";

import { useState } from "react";

import { buttonClass } from "@/components/ui/button";

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={buttonClass("quiet", "sm")}
    >
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}
