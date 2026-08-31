import { isWorkerId } from "@/adapters/terminal.ts";
import { fleetById, loadConfig } from "@/config/index.ts";
import { clockFor, fleetRuntime, terminalSourceFor } from "@/runtime/fleet.ts";
import type { TerminalTail } from "@/types/terminal.ts";

/**
 * The worker's terminal, on demand.
 *
 * The one route nothing on the first paint calls. A card that has never been
 * expanded never reaches here, which is the whole cost argument for the
 * feature: eleven collapsed cards read eleven sessions' worth of nothing.
 *
 * ## It reads
 *
 * `GET` and nothing else. There is no body to send, no input to accept and
 * nothing to write - the acting endpoint under `/api/act` is still the only
 * route with a writer behind it, and it is still the only one that asks for the
 * session secret. Reading needs none of it, the same way the page does not.
 *
 * ## Which fleet, and which worker
 *
 * The fleet is named on the request, exactly as the change stream names it: a
 * card asks about the fleet it was drawn from, not about whichever one a cookie
 * has since moved on to. The worker has to be one the fleet actually published,
 * checked against the current document before anything is read - upstream's own
 * peek resolves a selector with a colon in it as a raw session target, so
 * "which sessions may this panel look at" has to be answered by the fleet's own
 * list rather than by the shape of the string.
 */
export const dynamic = "force-dynamic";

/** A refusal, in the same shape a reading has, so one client path draws both. */
function refusal(worker: string, asOf: string, detail: string, status: number): Response {
  const tail: TerminalTail = {
    worker,
    asOf,
    reading: { read: "unreadable", detail },
  };
  return Response.json(tail, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function GET(request: Request) {
  const config = loadConfig(process.cwd());
  const params = new URL(request.url).searchParams;
  const fleet = fleetById(config, params.get("fleet"));
  const worker = params.get("worker") ?? "";
  const asOf = clockFor(config).now();

  if (!isWorkerId(worker)) {
    return refusal(worker, asOf, "That is not a work item id.", 400);
  }

  let known: boolean;
  try {
    const document = await fleetRuntime(config, fleet).document();
    known = document.fleet.content.some((candidate) => candidate.id === worker);
  } catch (error) {
    // A schema the panel refuses is the one failure the page itself cannot
    // survive; here it means the panel cannot say whose worker this is, and a
    // session is not read for a worker nobody has vouched for.
    return refusal(
      worker,
      asOf,
      `The ${fleet.label} fleet could not be read, so this session was not looked for: ${
        error instanceof Error ? error.message : String(error)
      }`,
      503,
    );
  }

  if (!known) {
    return refusal(
      worker,
      asOf,
      `The ${fleet.label} fleet has no worker called ${worker}.`,
      404,
    );
  }

  const reading = await terminalSourceFor(config, fleet).read(
    worker,
    AbortSignal.timeout(config.readTimeoutMs),
  );
  const tail: TerminalTail = { worker, asOf, reading };
  return Response.json(tail, { headers: { "cache-control": "no-store" } });
}
