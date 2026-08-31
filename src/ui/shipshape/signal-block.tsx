import { cn } from "@/ui/lib/utils";

/**
 * One health signal, drawn the same way three times.
 *
 * The three signals answer three different questions but they are read as one
 * column, so they share a shape: the answer first, as a chip, then the question
 * it answers, then whatever detail the document actually carries. An operator
 * scanning the panel gets three verdicts without reading a word; one who has
 * stopped on this lens gets the sentence underneath each.
 *
 * `data-signal`, `data-read` and `data-verdict` are how a test asserts that one
 * signal went dark while the others kept their verdicts.
 */

/**
 * What a verdict is worth looking at for.
 *
 * `dark` is not a fourth severity - it is the absence of a severity, and it is
 * drawn as one: grey, and dashed as well as grey, so an unread signal is told
 * apart from a read one by the shape of its edge rather than by hue alone. That
 * is the same convention the lifecycle rail uses for a worker off the track,
 * and it survives both themes and a reader who cannot see colour.
 */
export type Tone = "good" | "watch" | "bad" | "dark";

const TONE: Readonly<Record<Tone, { readonly chip: string; readonly edge: string }>> = {
  good: { chip: "bg-online text-online-foreground", edge: "border-l-online" },
  watch: { chip: "bg-warn text-warn-foreground", edge: "border-l-warn" },
  bad: { chip: "bg-danger text-danger-foreground", edge: "border-l-danger" },
  dark: {
    chip: "bg-muted text-muted-foreground",
    edge: "border-l-muted-foreground/40 border-dashed",
  },
};

export function SignalBlock({
  name,
  question,
  verdict,
  label,
  tone,
  children,
}: {
  /** The signal's name in the document, and its handle in the markup. */
  name: string;
  /** What this signal answers, in the operator's terms. */
  question: string;
  /** The answer as a stable slug, for a test to read. */
  verdict: string;
  /** The same answer in words, for a person to read. */
  label: string;
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <section
      data-signal={name}
      data-read={tone === "dark" ? "unreadable" : "ok"}
      data-verdict={verdict}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border-l-4 bg-muted/40 px-3 py-2.5",
        TONE[tone].edge,
      )}
    >
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-4xl px-2 py-0.5 font-mono text-[0.6875rem] tracking-wide uppercase",
            TONE[tone].chip,
          )}
        >
          {label}
        </span>
        <h3 className="min-w-0 text-xs text-muted-foreground">{question}</h3>
      </header>
      {children}
    </section>
  );
}

/**
 * A signal that could not be read.
 *
 * Two sentences, and the second one is the point. `detail` says what failed;
 * `unknown` says what the panel therefore does not know - written out rather
 * than left to the reader, because a silent gap where a verdict usually sits
 * reads as a quiet "fine", which is the one thing this lens must never say by
 * accident. Nothing here reports an age, a count or a verdict: the document
 * carries none of those for a signal that did not read.
 */
export function Unread({ detail, unknown }: { detail: string; unknown: string }) {
  return (
    <>
      <p className="text-xs break-words text-foreground">{detail}</p>
      <p className="text-xs text-muted-foreground">{unknown}</p>
    </>
  );
}
