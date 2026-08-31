import type { DeckItem } from "@/types/document.ts";
import { agoAtPrecision } from "@/ui/lib/age";
import { cn } from "@/ui/lib/utils";

/**
 * What a piece of work is and how long it has been, in one line.
 *
 * The deck draws it under a row and the needs-you band draws it under a card,
 * and both of those files used to carry their own copy. Their comments each
 * said the sentence had to be the same one - a decision an operator answers in
 * the band and the same work seen in the deck must not read as two different
 * jobs - and nothing made that true except two people remembering to keep it
 * true. This is that mechanism: one sentence, one order of fields, one set of
 * words for the state and the kind.
 *
 * What the two surfaces are still allowed to differ on is how loudly the line
 * sits on them, which is `emphasis`, and where it is indented to, which is
 * `className`. Neither changes what is said.
 */

const STATE_WORDS: Readonly<Record<DeckItem["state"], string>> = {
  queued: "queued",
  "in-flight": "in flight",
};

/** The same two words the fleet's cards use, so one job reads the same in both. */
const KIND_WORDS: Readonly<Record<NonNullable<DeckItem["kind"]>, string>> = {
  build: "build",
  research: "research",
};

export function ItemIdentity({
  item,
  nowMs,
  emphasis,
  className,
}: {
  item: DeckItem;
  nowMs: number;
  /**
   * The rank the two named parts sit at against the rest of the line.
   *
   * A token class, and the surface's to choose: the deck's rows sit on the
   * page's own ground and the band's cards sit under a heavier title, so the
   * same rank of text does not read the same on both.
   */
  emphasis: string;
  /** Where the surface indents the line to. */
  className?: string;
}) {
  return (
    /*
      Project and kind are shown only when the row said - a hand-written backlog
      line often names neither, and a guessed project is worse than an absent
      one. The date is the same: a row with no start says so rather than being
      stamped with the moment upstream looked, and a row whose start is a day
      reads as a day rather than as an hour count measured from a midnight the
      record never stated.
    */
    <p
      className={cn(
        "mt-0.5 text-[12px] wrap-anywhere text-term-faint",
        className,
      )}
    >
      <span className={item.since === null ? undefined : emphasis}>
        {item.since === null
          ? "no start date"
          : agoAtPrecision(item.since, nowMs)}
      </span>
      {` · ${STATE_WORDS[item.state]}`}
      {item.project !== null && (
        <>
          {" · "}
          <span className={emphasis}>{item.project}</span>
        </>
      )}
      {item.kind !== null && ` · ${KIND_WORDS[item.kind]}`}
      {` · ${item.id}`}
    </p>
  );
}
