"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FLEET_COOKIE, FLEET_COOKIE_MAX_AGE_SECONDS } from "@/types/selection.ts";
import { GrokProjectPicker } from "@/ui/components/grok/grok-project-picker";
import { GrokStatus } from "@/ui/components/grok/grok-status";
import { cn } from "@/ui/lib/utils";

/**
 * Which fleet the panel is looking at, and the way to change it.
 *
 * ## Why this wraps the panel rather than sitting beside it
 *
 * A switch is not instant: the cookie changes in the browser, the server reads
 * the other fleet, and only then does the content underneath change. In between
 * there is a moment where a careless picker would already be highlighting the
 * new fleet above numbers that still belong to the old one - a panel asserting
 * something it has not established, which is the failure this project keeps
 * finding in itself.
 *
 * So the picker owns the content. `showing` is a server prop: it arrives with
 * the very render the content came from and cannot move ahead of it, which is
 * what makes the mark on a chip a fact rather than an intention. What the
 * operator clicked is separate state, and while the two disagree the panel says
 * so in words - naming both fleets, so there is nothing to read ambiguously.
 *
 * ## Why a radiogroup and not a select
 *
 * A `<select>` moves its own value the instant it is clicked, before the server
 * has read anything. That is precisely the ambiguity above, built into the
 * control. An option that changes only when the render behind it does cannot
 * lie.
 *
 * ## The two marks, and why there are two
 *
 * `GrokProjectPicker` is a real radiogroup, so `aria-checked` already says what
 * the operator has selected. That is not the same fact as which fleet the page
 * below was read from, and this component exists because the two can disagree
 * for as long as a switch takes. So the row also carries `aria-current`, which
 * moves only when the render does: checked is the intention, current is the
 * fact. A reader gets both, in the same order the sighted panel gives them.
 *
 * It replaced a row of chips. The chips were one click each and the list is now
 * a column, which costs vertical room in the masthead - see the note in
 * `docs/decisions/2026-08-31-the-terminal-grammar.md` about what the fold would
 * not pay for.
 *
 * ## Why it no longer owns the page's height
 *
 * It used to: the panel was exactly one viewport tall and each lens scrolled
 * inside itself, and the height chain started here. The page scrolls as a page
 * again, so this wrapper only stacks the nav above the panel. It also carries
 * no maximum width any more - see
 * `docs/decisions/2026-08-31-what-needs-you-owns-the-first-screen.md`.
 */

/** One fleet, as the operator sees it. The id is the panel's, the label theirs. */
export interface FleetChoice {
  readonly id: string;
  readonly label: string;
}

/**
 * Remembering, in the browser.
 *
 * `SameSite=Lax` because the panel is loopback-only and another site must not
 * be able to steer which fleet an operator is shown. No `Secure`: the panel is
 * served over plain HTTP on localhost, and a `Secure` cookie would simply never
 * be stored.
 */
function remember(id: string): void {
  const value = encodeURIComponent(id);
  document.cookie = `${FLEET_COOKIE}=${value}; path=/; max-age=${FLEET_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

export function FleetPicker({
  fleets,
  showing,
  children,
}: {
  fleets: readonly FleetChoice[];
  /** The fleet `children` were rendered from. Never what the operator just clicked. */
  showing: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [wanted, setWanted] = useState<string | null>(null);

  const showingFleet = fleets.find((fleet) => fleet.id === showing);
  const wantedFleet = fleets.find((fleet) => fleet.id === wanted);
  // Only a genuine disagreement counts as a switch in flight: once the new
  // render lands, `showing` catches up and this goes quiet on its own.
  const switching = pending && wantedFleet !== undefined && wanted !== showing;

  const select = (id: string) => {
    if (id === showing) return;
    remember(id);
    setWanted(id);
    startTransition(() => router.refresh());
  };

  return (
    <div
      data-fleet={showing}
      data-switching-to={switching ? wanted : undefined}
      className="flex min-h-full w-full min-w-0 flex-col"
    >
      <nav
        aria-label="Fleet"
        className="flex w-full min-w-0 shrink-0 flex-col gap-2 px-4 pt-3 sm:px-6"
      >
        {/* The frame's top line: what is being read, and how much of it. The
            counts an agent CLI puts here are its context window and its turn;
            the panel's equivalent is how many fleets it can see and which of
            them this is. */}
        <GrokStatus
          branch="quarterdeck"
          directory={showingFleet?.label ?? showing}
          contextUsed={String(fleets.findIndex((fleet) => fleet.id === showing) + 1)}
          contextLimit={`${fleets.length} fleet${fleets.length === 1 ? "" : "s"}`}
        />

        <GrokProjectPicker
          title="Fleet"
          description={
            <p role="status" data-fleet-note className={switching ? "text-term-warning" : undefined}>
              {switching ? (
                <>
                  Switching to {wantedFleet.label} &mdash; everything below is
                  still {showingFleet?.label ?? showing}.
                </>
              ) : fleets.length === 1 ? (
                <>The only fleet this panel is configured to see.</>
              ) : (
                <>Which fleet the panel is reading. Remembered in this browser.</>
              )}
            </p>
          }
          projects={fleets.map((fleet) => ({
            id: fleet.id,
            name: fleet.label,
            // The id only when it is not just the label again: it is what the
            // cookie and the change stream carry, so it is worth showing when
            // the two differ and noise when they do not.
            path: fleet.id === fleet.label ? undefined : fleet.id,
            meta: fleet.id === showing ? "showing" : undefined,
            current: fleet.id === showing,
            data: { "data-fleet-choice": fleet.id },
          }))}
          defaultSelected={Math.max(
            0,
            fleets.findIndex((fleet) => fleet.id === (wanted ?? showing)),
          )}
          custom={false}
          onChoose={(index) => {
            if (index === "custom") return;
            select(fleets[index].id);
          }}
        />
      </nav>

      {/* Dimmed and marked busy, never blanked: the previous fleet's picture is
          still worth reading while the next one is fetched, as long as nothing
          claims it belongs to the fleet being switched to. */}
      <div
        aria-busy={switching || undefined}
        className={cn(
          "flex min-w-0 flex-col transition-opacity",
          switching && "opacity-50",
        )}
      >
        {children}
      </div>
    </div>
  );
}
