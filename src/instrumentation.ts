/**
 * The one thing that runs before any request: the stop path.
 *
 * Next calls `register()` once per server process, which is the only place the
 * panel gets to act on the process itself rather than on a request. It is a
 * composition point in the same sense `src/proxy.ts` is - it wires, it does not
 * decide - so it holds nothing but the wiring.
 *
 * See `src/runtime/shutdown.ts` for what is being registered and why.
 */
export async function register(): Promise<void> {
  // The panel only ever runs on Node; the guard is there because `register` is
  // also called for an edge runtime, where there are no process signals to
  // listen for and the import below would not resolve.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { watchForShutdown } = await import("./runtime/shutdown.ts");
  watchForShutdown();
}
