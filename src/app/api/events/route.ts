import { fleetById, loadConfig } from "@/config/index.ts";
import { fleetRuntime } from "@/runtime/fleet.ts";
import { closeOnShutdown, isStopping } from "@/runtime/shutdown.ts";

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
  // A page whose stream the stop just closed reconnects at once - that is what
  // lets a restarted server pick straight back up - and a reconnection landing
  // on a connection the closing server still holds would open a stream nothing
  // is left to close. Opening and immediately closing one is no better: the
  // page reconnects again, and the loop keeps the panel alive exactly as the
  // first stream did. So a stopping panel refuses the stream, with a status and
  // a content type that tell `EventSource` to stop asking rather than retry.
  if (isStopping()) {
    return new Response("the panel is stopping\n", {
      status: 503,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        connection: "close",
      },
    });
  }

  const config = loadConfig(process.cwd());
  const fleet = fleetById(
    config,
    new URL(request.url).searchParams.get("fleet"),
  );
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

      const unsubscribe = runtime.subscribe(() =>
        send("event: fleet-changed\ndata:\n\n"),
      );

      // A client going away is one way this stream ends. The other is the panel
      // being asked to stop: this response never finishes on its own, and
      // Next's shutdown waits for every open connection, so a stream nobody
      // closed keeps a panel the operator has stopped running and holding its
      // port. Both endings run the same three steps, and each is written to
      // survive the other having run first. See `src/runtime/shutdown.ts`.
      let forget = () => {};
      const end = () => {
        unsubscribe();
        forget();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime tearing the stream down.
        }
      };
      forget = closeOnShutdown(end);

      // The refusal above reads `isStopping` before this stream exists; a stop
      // that began in between would leave this one open with nothing left to
      // close it. Reading it again here, after the register holds `end`, closes
      // that window.
      if (isStopping()) end();

      request.signal.addEventListener("abort", end);
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
