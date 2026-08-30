import { ContractIdentifierError } from "@/adapters/contract.ts";
import { loadConfig, type Config } from "@/config/index.ts";
import { clockFor, fleetRuntime } from "@/runtime/fleet.ts";
import type { FleetDocument } from "@/types/document.ts";
import { ContractRefusal } from "@/ui/contract-refusal";
import { FleetPanel } from "@/ui/fleet-panel";
import { LiveRefresh } from "@/ui/live-refresh";

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
  | { readonly kind: "document"; readonly document: FleetDocument }
  | {
      readonly kind: "refusal";
      readonly expected: string;
      readonly found: string;
      readonly source: string;
    };

async function read(config: Config): Promise<Outcome> {
  try {
    return { kind: "document", document: await fleetRuntime(config).document() };
  } catch (error) {
    if (error instanceof ContractIdentifierError) {
      return {
        kind: "refusal",
        expected: error.expected,
        found: JSON.stringify(error.found),
        source: error.source,
      };
    }
    throw error;
  }
}

export default async function Page() {
  const config = loadConfig(process.cwd());
  const outcome = await read(config);

  if (outcome.kind === "refusal") {
    return (
      <ContractRefusal
        expected={outcome.expected}
        found={outcome.found}
        source={outcome.source}
      />
    );
  }

  return (
    <>
      <LiveRefresh endpoint="/api/events" />
      <FleetPanel document={outcome.document} nowMs={clockFor(config).nowMs()} />
    </>
  );
}
