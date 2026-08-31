import { cookies } from "next/headers";
import {
  ContractIdentifierError,
  SNAPSHOT_REBUILD,
} from "@/adapters/contract.ts";
import {
  fleetById,
  loadConfig,
  type Config,
  type FleetRef,
} from "@/config/index.ts";
import { clockFor, fleetRuntime } from "@/runtime/fleet.ts";
import { SESSION_HEADER, sessionSecret } from "@/runtime/session.ts";
import type { PanelDocument } from "@/types/document.ts";
import { FLEET_COOKIE } from "@/types/selection.ts";
import { ContractRefusal } from "@/ui/contract-refusal";
import { FleetPicker } from "@/ui/fleet-picker";
import { Shell } from "@/ui/shell";
import { LiveRefresh } from "@/ui/live-refresh";
import type { AnsweringSession } from "@/ui/lib/answering";
import type { MergeSession } from "@/ui/needs-you/merge-card";
import type { TerminalReader } from "@/ui/fleet/worker-terminal";
import type { Rebuild } from "@/ui/snapshot-badge";

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
    return {
      kind: "document",
      document: await fleetRuntime(config, fleet).document(),
    };
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
 * How the page orders a merge, or `null` when it may not.
 *
 * The same gate, the same secret and the same argument as `answering` above:
 * both write through the one permitted writer into the one spool, so a fleet
 * with nowhere to record has neither control and hands out no secret. Only the
 * address differs, because the two orders are two intents and each card posts
 * to the one it is about.
 */
function merging(fleet: FleetRef): MergeSession | null {
  if (fleet.intentDir === null) return null;
  return {
    header: SESSION_HEADER,
    secret: sessionSecret(),
    endpoint: "/api/act/merge-pull-request",
  };
}

/**
 * Where a card reads its worker's session, with the fleet already named.
 *
 * Named on the address rather than left to the selection cookie: a card asks
 * about the fleet it was drawn from, and a switch that lands between the render
 * and the click must not answer out of the other fleet's sessions - the same
 * reason the change stream carries the fleet on its query.
 *
 * Nothing calls it on the first paint. It exists so that a card the operator
 * expands has somewhere to ask.
 */
function terminalReader(fleet: FleetRef): TerminalReader {
  return { endpoint: `/api/terminal?fleet=${encodeURIComponent(fleet.id)}` };
}

/**
 * How the operator makes a newer snapshot, or `null` when nothing here would.
 *
 * A fleet home publishes its own snapshot command and running it is what
 * produces a fresher picture, so the badge can offer the exact line. A fixture
 * set has no such command - it is a committed file - and inventing one for it
 * would be the panel telling an operator to run something that does not exist.
 *
 * The command goes out relative to the home, and the home is named by the
 * fleet's label rather than by its path: `src/config/` keeps full home paths
 * out of the markup on purpose, and this is not the place to make an exception.
 */
function rebuilding(fleet: FleetRef): Rebuild | null {
  if (fleet.source.kind !== "home") return null;
  return { command: SNAPSHOT_REBUILD, where: fleet.label };
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
      <LiveRefresh
        endpoint={`/api/events?fleet=${encodeURIComponent(fleet.id)}`}
      />
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
          terminal={terminalReader(fleet)}
          session={answering(fleet)}
          merging={merging(fleet)}
          rebuild={rebuilding(fleet)}
        />
      )}
    </FleetPicker>
  );
}
