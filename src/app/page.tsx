import { cookies } from "next/headers";
import { ContractIdentifierError } from "@/adapters/contract.ts";
import { fleetById, loadConfig, type Config, type FleetRef } from "@/config/index.ts";
import { clockFor, fleetRuntime } from "@/runtime/fleet.ts";
import { SESSION_HEADER, sessionSecret } from "@/runtime/session.ts";
import type { PanelDocument } from "@/types/document.ts";
import { FLEET_COOKIE } from "@/types/selection.ts";
import { ContractRefusal } from "@/ui/contract-refusal";
import { FleetPicker } from "@/ui/fleet-picker";
import { Shell } from "@/ui/shell";
import { LiveRefresh } from "@/ui/live-refresh";
import type { AnsweringSession } from "@/ui/deck/answer-control";

/**
 * The composition point.
 *
 * `src/app/` is the one place that may see both the runtime and the UI. It sits
 * outside the six layers on purpose: Next owns this directory, and invariant 6
 * keeps fleet reading out of `src/ui/`, so the wiring has to live somewhere
 * that is neither. Route files stay this thin - read, translate, hand to a
 * component - and everything else belongs in a layer.
 */
export const dynamic = "force-dynamic";

/**
 * Reading and translating, kept apart from rendering.
 *
 * The one error the panel renders rather than degrades through is turned into
 * plain data here, which is both why `src/ui/` never imports from `adapters`
 * and why no JSX is built inside a `try` - React would construct it after the
 * block had already been left, so the `catch` would never see its errors.
 */
type Outcome =
  | { readonly kind: "document"; readonly document: PanelDocument }
  | {
      readonly kind: "refusal";
      readonly expected: string;
      readonly found: string;
      readonly source: string;
    };

async function read(config: Config, fleet: FleetRef): Promise<Outcome> {
  try {
    return { kind: "document", document: await fleetRuntime(config, fleet).document() };
  } catch (error) {
    if (error instanceof ContractIdentifierError) {
      return {
        kind: "refusal",
        // Both go through JSON.stringify so they read the same way side by
        // side, and so a `found` that is not a string - undefined, a number -
        // still shows what it actually was.
        expected: JSON.stringify(error.expected),
        found: JSON.stringify(error.found),
        source: error.source,
      };
    }
    throw error;
  }
}

/**
 * How the page reaches the acting endpoint, or `null` when it may not.
 *
 * The session secret reaches the browser here for the first time, which the
 * security baseline named as part of the write path rather than a change to it.
 * What keeps it safe is unchanged and all of it is tested: the panel binds to
 * loopback, the proxy refuses any Host or Origin that is not this instance's
 * own, no cross-origin sharing header is ever set, and the CSP names no remote
 * destination - so a page on the web can neither read this document nor use the
 * secret if it somehow had it.
 *
 * `null` when nothing is configured to carry an answer to the fleet. The panel
 * then says so on the card rather than offering a control that cannot work, and
 * the secret is not handed out at all.
 *
 * Gated on the selected fleet's own spool, not a panel-wide one: which fleet is
 * on screen is what the answer would be about, so whether the control can work
 * at all has to follow the same selection.
 */
function answering(fleet: FleetRef): AnsweringSession | null {
  if (fleet.intentDir === null) return null;
  return {
    header: SESSION_HEADER,
    secret: sessionSecret(),
    endpoint: "/api/act/answer-decision",
  };
}

/**
 * Which fleet the operator last chose, or the first one configured.
 *
 * The selection is remembered in their browser rather than on this machine, so
 * it arrives on the request like any other cookie. An id naming a fleet the
 * panel no longer has - the list is a setting, and a setting can change under a
 * remembered choice - falls back rather than refusing; the picker then shows
 * the fallback as the fleet being shown, which is the truth.
 */
async function selectedFleet(config: Config): Promise<FleetRef> {
  return fleetById(config, (await cookies()).get(FLEET_COOKIE)?.value);
}

export default async function Page() {
  const config = loadConfig(process.cwd());
  const fleet = await selectedFleet(config);
  const outcome = await read(config, fleet);
  const choices = config.fleets.map(({ id, label }) => ({ id, label }));

  return (
    // Everything the panel draws sits inside the picker, including the refusal:
    // a fleet whose snapshot this build cannot read is still one an operator has
    // to be able to select away from.
    <FleetPicker fleets={choices} showing={fleet.id}>
      {/* The signal stream is per fleet, so a switch listens to the fleet on
          screen rather than to the one that was there before it. */}
      <LiveRefresh endpoint={`/api/events?fleet=${encodeURIComponent(fleet.id)}`} />
      {outcome.kind === "refusal" ? (
        <ContractRefusal
          expected={outcome.expected}
          found={outcome.found}
          source={outcome.source}
        />
      ) : (
        <Shell
          document={outcome.document}
          nowMs={clockFor(config).nowMs()}
          session={answering(fleet)}
        />
      )}
    </FleetPicker>
  );
}
