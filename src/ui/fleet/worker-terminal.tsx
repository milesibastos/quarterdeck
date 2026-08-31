"use client";

import { useCallback, useRef, useState } from "react";
import { TERMINAL_LINES, type TerminalTail } from "@/types/terminal.ts";

/**
 * The worker's terminal, on demand.
 *
 * The one feature no earlier attempt at fleet visibility gave the operator:
 * what the worker is actually saying, in the card, without leaving the panel.
 *
 * ## Nothing until it is opened
 *
 * This component renders a closed disclosure and nothing else until somebody
 * expands it. No effect runs on mount, nothing is prefetched, and a card that
 * is never opened costs one `<details>` element. That is the strictest of the
 * wireframe's cost rules and the whole reason the feature is affordable at a
 * fleet of thirty.
 *
 * ## Why it survives a refresh
 *
 * The page refreshes itself, and an update must never move the page under the
 * reader. Two things keep an open terminal open:
 *
 * - The disclosure is native and `open` is never set from React. The browser
 *   owns whether it is expanded; a re-render reconciles the same element rather
 *   than rebuilding it, so it stays as the operator left it. Same trick as the
 *   brief disclosure above it on the card.
 * - The lines live in this component's state, not in the server markup. A
 *   `router.refresh()` re-renders the server tree around this island and leaves
 *   its state alone, so nothing is refetched, no content changes, the scrolling
 *   element is not replaced, and the scroll position is exactly where it was.
 *
 * Which is also why a refresh does not bring newer lines: the tail is what the
 * session said when the operator asked, dated, with a control to ask again.
 * Lines appearing under a reader mid-sentence is the "never move the page"
 * ruling being broken by a feature that meant well.
 */

/**
 * How this card reaches the read.
 *
 * A whole endpoint rather than a fleet id, so `src/ui/` never learns how the
 * panel names its fleets - the same shape `LiveRefresh` is handed, built at the
 * composition point.
 */
export interface TerminalReader {
  /** The read, with its fleet already named. The worker is appended to it. */
  readonly endpoint: string;
}

/** `09:15:30`, from the instant the read was taken. */
function clockTime(instant: string): string {
  const at = new Date(instant);
  return Number.isNaN(at.getTime()) ? instant : at.toLocaleTimeString();
}

/**
 * A tail that is not lines, drawn as the thing it actually is.
 *
 * Three different facts, three different sentences, and never a blank box. A
 * session that is gone, one that could not be read and one that has said
 * nothing yet call for three different responses from an operator, and merging
 * them into an empty frame tells them none of it.
 */
function Absence({
  headline,
  detail,
  tone,
}: {
  headline: string;
  /** One concrete line under it. Always present: a headline alone is a shrug. */
  detail: string;
  tone: "quiet" | "danger";
}) {
  return (
    <div
      className={
        tone === "danger"
          ? "rounded-sm border border-dashed border-term-danger/40 px-3 py-4 text-center"
          : "rounded-sm border border-dashed border-term-rule px-3 py-4 text-center"
      }
    >
      <p className="text-xs text-term-fg-bright">{headline}</p>
      {detail !== null && (
        <p className="mt-1 text-xs wrap-anywhere text-term-muted">{detail}</p>
      )}
    </div>
  );
}

/**
 * The lines themselves.
 *
 * `pre` with no wrapping and its own horizontal scroll: a pane's lines mean
 * what they mean at their own width, and re-wrapping a table of check results
 * into a paragraph makes it unreadable. The overflow is the box's, never the
 * page's - the shell's rule is that nothing scrolls the page sideways, and a
 * scroll container is how a two-hundred-column line obeys it.
 *
 * The height is capped and scrolls, so fifteen lines of anything - including
 * fifteen very long ones - occupy the same amount of card.
 */
function Lines({ lines }: { lines: readonly string[] }) {
  return (
    <pre
      data-terminal-lines={lines.length}
      tabIndex={0}
      // Ligatures off: the vendored mono face draws `==>` as a single arrow
      // glyph, which is charming in source and a lie in a pane capture - the
      // worker printed three characters and the page must show three.
      className="max-h-56 overflow-auto rounded-sm border border-term-rule bg-term-bg px-3 py-2 font-mono text-[12px] leading-[1.45] whitespace-pre text-term-fg [font-variant-ligatures:none]"
    >
      {lines.join("\n")}
    </pre>
  );
}

function Tail({ tail }: { tail: TerminalTail }) {
  const { reading } = tail;
  switch (reading.read) {
    case "ok":
      return <Lines lines={reading.lines} />;
    case "silent":
      return (
        <Absence
          headline="Nothing said yet"
          detail="The session was read and had no output. The worker has not printed anything."
          tone="quiet"
        />
      );
    case "no-session":
      return (
        <Absence headline="No session to read" detail={reading.detail} tone="quiet" />
      );
    case "unreadable":
      return (
        <Absence
          headline="The session could not be read"
          detail={reading.detail}
          tone="danger"
        />
      );
  }
}

export function WorkerTerminal({
  worker,
  reader,
}: {
  /** The work item, as the fleet published it. */
  worker: string;
  reader: TerminalReader;
}) {
  /**
   * The last read, kept across a re-read on purpose: the lines already on
   * screen stay there while a newer tail is being fetched, so asking again
   * never blanks the box the operator is reading and never destroys the
   * element their scroll position belongs to.
   */
  const [tail, setTail] = useState<TerminalTail | null>(null);
  const [reading, setReading] = useState(false);
  /** Set for the life of the card once a read has been asked for. */
  const asked = useRef(false);

  const read = useCallback(async () => {
    asked.current = true;
    setReading(true);
    const url = `${reader.endpoint}&worker=${encodeURIComponent(worker)}`;
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
      });
      // The route answers with a reading on every status it returns, including
      // its refusals, so there is one shape to draw rather than two.
      setTail((await response.json()) as TerminalTail);
    } catch (error) {
      setTail({
        worker,
        // The read never happened, so there is no instant from the server to
        // date it by. The detail says which of the two it was.
        asOf: "",
        reading: {
          read: "unreadable",
          detail: `The panel could not be asked for this session: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      });
    } finally {
      setReading(false);
    }
  }, [reader.endpoint, worker]);

  return (
    <details
      data-terminal={worker}
      className="group/terminal font-mono text-[13px] leading-[1.55]"
      // Fires on open and on close. Only the first open reads; closing and
      // reopening shows what was already read, because a disclosure toggled by
      // accident must not start a process.
      onToggle={(event) => {
        if (event.currentTarget.open && !asked.current) void read();
      }}
    >
      <summary className="cursor-pointer list-none text-term-muted hover:text-term-fg-bright">
        terminal
        <span aria-hidden="true" className="ms-1 inline-block group-open/terminal:rotate-90">
          &rsaquo;
        </span>
      </summary>

      <div className="mt-1.5 flex flex-col gap-1.5 border-t border-term-rule-soft pt-1.5">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px] text-term-faint">
          <span>last {TERMINAL_LINES} lines &middot; read only</span>
          {/* Live, because what it says changes without the page moving: a
              reader who cannot see "reading" become "read at 09:15" is being
              told nothing happened. The control is outside it, so asking again
              does not announce itself twice. */}
          <span role="status" className="text-term-muted">
            {reading
              ? "reading the session\u2026"
              : tail !== null && tail.asOf !== ""
                ? `read at ${clockTime(tail.asOf)}`
                : ""}
          </span>
          {tail !== null && (
            <button
              type="button"
              onClick={() => void read()}
              disabled={reading}
              className="ms-auto cursor-pointer underline-offset-2 hover:text-term-fg-bright hover:underline disabled:cursor-default disabled:no-underline"
            >
              read again
            </button>
          )}
        </p>

        {tail !== null && <Tail tail={tail} />}
      </div>
    </details>
  );
}
