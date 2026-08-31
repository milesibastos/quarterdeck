"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FLEET_COOKIE, FLEET_COOKIE_MAX_AGE_SECONDS } from "@/types/selection.ts";
import { buttonVariants } from "@/ui/components/button";
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
 * ## Why a row of chips and not a select
 *
 * A `<select>` moves its own value the instant it is clicked, before the server
 * has read anything. That is precisely the ambiguity above, built into the
 * control. A chip that changes only when the render behind it does cannot lie.
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
    <div data-fleet={showing} data-switching-to={switching ? wanted : undefined}>
      <nav
        aria-label="Fleet"
        className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-6 pt-6"
      >
        <span className="font-mono text-[0.6875rem] tracking-widest uppercase text-muted-foreground">
          Fleet
        </span>

        <ul className="flex flex-wrap items-center gap-1.5">
          {fleets.map((fleet) => {
            const current = fleet.id === showing;
            return (
              <li key={fleet.id}>
                <button
                  type="button"
                  data-fleet-choice={fleet.id}
                  aria-current={current ? "true" : undefined}
                  onClick={() => select(fleet.id)}
                  className={cn(
                    buttonVariants({ variant: current ? "secondary" : "outline", size: "sm" }),
                    "font-mono",
                  )}
                >
                  {fleet.label}
                  {current && (
                    <span className="text-[0.625rem] tracking-widest uppercase opacity-70">
                      showing
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <p
          role="status"
          data-fleet-note
          className={cn(
            "basis-full text-sm sm:basis-auto",
            switching ? "text-warn" : "text-muted-foreground",
          )}
        >
          {switching ? (
            <>
              Switching to {wantedFleet.label} &mdash; everything below is still{" "}
              {showingFleet?.label ?? showing}.
            </>
          ) : fleets.length === 1 ? (
            <>The only fleet this panel is configured to see.</>
          ) : null}
        </p>
      </nav>

      {/* Dimmed and marked busy, never blanked: the previous fleet's picture is
          still worth reading while the next one is fetched, as long as nothing
          claims it belongs to the fleet being switched to. */}
      <div
        aria-busy={switching || undefined}
        className={cn("transition-opacity", switching && "opacity-50")}
      >
        {children}
      </div>
    </div>
  );
}
