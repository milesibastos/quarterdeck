import { GrokEvent } from "@/ui/components/grok/grok-event";
import { cn } from "@/ui/lib/utils";

/**
 * One health signal, drawn the same way five times.
 *
 * The five signals answer five different questions but they are read as one
 * column, so they share a shape: the answer first, on the event line, then the
 * question it answers, then whatever detail the document actually carries. An
 * operator scanning the panel gets five verdicts without reading a word; one
 * who has stopped on this lens gets the detail underneath each.
 *
 * `data-signal`, `data-read` and `data-verdict` are how a test asserts that one
 * signal went dark while the others kept their verdicts.
 *
 * ## Why the header is a `GrokEvent`
 *
 * A health signal is an event the supervision cycle reported, not a gauge the
 * panel is sampling, so it reads as one: `◆` and the verdict, with the question
 * beside it. The line comes from the vendored component rather than from a
 * plainer copy of it beside one - see
 * `docs/decisions/2026-08-31-the-shipshape-strip-in-the-grok-grammar.md`, which
 * also records why `GrokStatus` was declined.
 */

/**
 * What a verdict is worth looking at for.
 *
 * `dark` is not a fourth severity - it is the absence of a severity, and it is
 * drawn as one: the muted rank, and dashed as well as muted, so an unread
 * signal is told apart from a read one by the shape of its edge rather than by
 * hue alone. That is the same convention the lifecycle rail uses for a worker
 * off the track, and it survives both themes and a reader who cannot see
 * colour.
 *
 * `ink` is what the verdict word itself is written in. `GrokEvent` paints its
 * label from `--term-fg` and exposes no tone, so the tone is applied by
 * rebinding that token on the one element wrapping it: token to token, no
 * colour value, and no edit to a vendored file three other workers share. It
 * reaches nothing else, because everything below sets its own rank. Uniform ink
 * on all five verdicts would have made `Stopped` read calmer than it is, which
 * is the one direction this lens may never drift.
 *
 * `dark` takes a rank rather than a hue - it is not a severity - and the rank
 * is `--term-dim` rather than the `--term-muted` the question beside it uses.
 * Measured on the page with all five signals unread: at the same rank the
 * verdict and the question ran together as one grey line, which is the state
 * this lens is most likely to be read in on a bad day. Brighter than the
 * question, colourless, and dashed at the edge.
 */
type Tone = "good" | "watch" | "bad" | "dark";

const TONE: Readonly<
  Record<Tone, { readonly ink: string; readonly edge: string }>
> = {
  good: { ink: "var(--term-success)", edge: "border-l-term-success" },
  watch: { ink: "var(--term-warning)", edge: "border-l-term-warning" },
  bad: { ink: "var(--term-danger)", edge: "border-l-term-danger" },
  dark: { ink: "var(--term-dim)", edge: "border-l-term-faint border-dashed" },
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
        "flex min-w-0 flex-col gap-1 border-l-2 pl-3 font-mono text-[13px] leading-[1.55] text-term-fg",
        TONE[tone].edge,
      )}
    >
      {/* The wrapper exists to scope the rebinding above to the event line. */}
      <div style={{ "--term-fg": TONE[tone].ink } as React.CSSProperties}>
        <GrokEvent label={label}>
          <h3 className="min-w-0 text-term-muted">{question}</h3>
        </GrokEvent>
      </div>
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
export function Unread({
  detail,
  unknown,
}: {
  detail: string;
  unknown: string;
}) {
  return (
    <>
      <p className="wrap-anywhere">{detail}</p>
      <p className="text-term-muted">{unknown}</p>
    </>
  );
}
