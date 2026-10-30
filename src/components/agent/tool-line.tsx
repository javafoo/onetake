import Link from "next/link";

/* What the agent did on its way to an answer, as muted one-liners: it
   searched, it read, it remembered. Labels only; what a tool found stays on
   the server. */

export function ToolLines({ labels }: { labels: string[] }) {
  return (
    <ul className="space-y-0.5">
      {labels.map((label, index) => (
        <li key={`${index}:${label}`} className="flex items-center gap-2 text-xs text-muted">
          <span aria-hidden className="size-1 shrink-0 rounded-full bg-line-strong" />
          <span className="min-w-0 truncate">{label}</span>
        </li>
      ))}
    </ul>
  );
}

/** A fact it wrote down about her, with where to change it. */
export function FactLine({ text }: { text: string }) {
  return (
    <p className="text-xs text-muted">
      <span className="font-medium text-ink-soft">Remembered:</span> {text}.{" "}
      <Link href="/brand" className="underline underline-offset-2 hover:text-ink">
        Change it on the Brand page
      </Link>
    </p>
  );
}
