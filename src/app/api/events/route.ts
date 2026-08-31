import { fleetById, loadConfig } from "@/config/index.ts";
import { fleetRuntime } from "@/runtime/fleet.ts";

/**
 * The change signal.
 *
 * One event, carrying no data. The client answers it by asking the server to
 * re-render; sending the document down this pipe instead would mean the client
 * rebuilding the page from data, which is what makes cards flicker and scroll
 * positions jump.
 *
 * Which fleet's changes a stream carries is named on the request, because the
 * page names it: a client watching the fleet it is not showing would refresh
 * for the wrong reasons and stay still for the right ones. An unknown name
 * falls back the same way the page does, so the two always agree.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const config = loadConfig(process.cwd());
  const fleet = fleetById(config, new URL(request.url).searchParams.get("fleet"));
  const runtime = fleetRuntime(config, fleet);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (frame: string) => {
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          // The client went away between the signal and this write.
        }
      };

      // Names the stream open so a reconnecting client knows it is live again.
      send(": open\n\n");

      const unsubscribe = runtime.subscribe(() => send("event: fleet-changed\ndata:\n\n"));

      request.signal.addEventListener("abort", () => {
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime tearing the stream down.
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      // Nothing sits in front of this server today, but a buffering proxy would
      // hold every signal until the stream closed, which is silent and awful.
      "x-accel-buffering": "no",
    },
  });
}
