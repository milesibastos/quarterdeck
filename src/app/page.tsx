import { ContractIdentifierError } from "@/adapters/contract.ts";
import { loadConfig, type Config } from "@/config/index.ts";
import { clockFor, fleetRuntime } from "@/runtime/fleet.ts";
import { SESSION_HEADER, sessionSecret } from "@/runtime/session.ts";
import type { PanelDocument } from "@/types/document.ts";
import { ContractRefusal } from "@/ui/contract-refusal";
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

async function read(config: Config): Promise<Outcome> {
  try {
    return { kind: "document", document: await fleetRuntime(config).document() };
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
 */
function answering(config: Config): AnsweringSession | null {
  if (config.intentDir === null) return null;
  return {
    header: SESSION_HEADER,
    secret: sessionSecret(),
    endpoint: "/api/act/answer-decision",
  };
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
      <Shell
        document={outcome.document}
        nowMs={clockFor(config).nowMs()}
        session={answering(config)}
      />
    </>
  );
}
