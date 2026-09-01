/**
 * The two things that run before any request: the stop path, and the one error
 * the panel refuses to print as an error.
 *
 * Next calls `register()` once per server process, which is the only place the
 * panel gets to act on the process itself rather than on a request. It is a
 * composition point in the same sense `src/proxy.ts` is - it wires, it does not
 * decide - so it holds nothing but the wiring.
 *
 * See `src/runtime/shutdown.ts` for the first, and
 * `explainPagesThatLeave` in `src/providers/logger.ts` for the second.
 */
export async function register(): Promise<void> {
  // The panel only ever runs on Node; the guard is there because `register` is
  // also called for an edge runtime, where there are no process signals to
  // listen for and the imports below would not resolve.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { watchForShutdown } = await import("./runtime/shutdown.ts");
  watchForShutdown();
  const { explainPagesThatLeave } = await import("./providers/logger.ts");
  explainPagesThatLeave();
}
