import { consoleLogger, type Logger } from "../providers/logger.ts";
import { stopFleetRuntimes } from "./fleet.ts";

/**
 * The stop path.
 *
 * Next's production shutdown asks the HTTP server to close and then waits for
 * every connection still on it to finish, because a request half-served is
 * worse than a slow exit. The change signal is a response that never finishes
 * on its own: it is held open for as long as a page is watching. So a panel
 * with one open tab never exits on a polite quit request. The operator's shell
 * takes its prompt back - the launcher above it is gone - while the server
 * keeps running behind it, keeps the port, and prints whatever its last
 * half-torn-down render has to say on top of the prompt. That is the whole of
 * the reported fault; see
 * `docs/decisions/2026-09-01-stopping-the-panel.md`.
 *
 * Anything that holds a connection open past the end of a request therefore has
 * to be closed by hand here. This is the register of those things: a stream
 * enrols when it opens and forgets when it closes, and one signal handler
 * closes whatever is still enrolled.
 */

/** What a long-lived response registers so the stop path can end it. */
type Closer = () => void;

interface ShutdownState {
  readonly closers: Set<Closer>;
  /** Set once the signal handlers are on, so a second call adds no second pair. */
  watching: boolean;
  /** Set while closing, so two signals in a row do not run the close twice. */
  stopping: boolean;
}

/**
 * Held on `globalThis` for the same reason the runtimes are: a route module can
 * be evaluated more than once in one process, and a per-module register would
 * leave a stream enrolled in a set the signal handler cannot see.
 */
const STATE = Symbol.for("quarterdeck.shutdown");

type Host = typeof globalThis & { [STATE]?: ShutdownState };

function state(): ShutdownState {
  const host = globalThis as Host;
  return (host[STATE] ??= {
    closers: new Set<Closer>(),
    watching: false,
    stopping: false,
  });
}

/**
 * Enrol a long-lived response. Returns the way to forget it.
 *
 * Forgetting matters as much as enrolling: a panel that has been open for a
 * day has opened and closed a stream every time a page reloaded, and a register
 * that only grows would hold every one of those closures alive.
 */
export function closeOnShutdown(close: Closer): () => void {
  const { closers } = state();
  closers.add(close);
  return () => closers.delete(close);
}

/** Whether the stop has begun, so a new stream does not open into a closing server. */
export function isStopping(): boolean {
  return state().stopping;
}

/**
 * Close everything held open, once.
 *
 * It does not exit, and must not: Next's own handler is already waiting on
 * `server.close()`, and this is what lets that wait finish.
 */
function stopPanel(logger: Logger = consoleLogger): void {
  const current = state();
  if (current.stopping) return;
  current.stopping = true;

  const held = current.closers.size;
  for (const close of current.closers) {
    try {
      close();
    } catch {
      // A stream already torn down by the client is not a failure to stop.
    }
  }
  current.closers.clear();
  stopFleetRuntimes();

  logger.info("stopping", { streamsClosed: held });
}

/**
 * Put the stop path on the process's termination signals.
 *
 * Additive, deliberately: Next installs its own handler for both signals and
 * this one runs after it, while `server.close()` is pending. Replacing Next's
 * would drop the request-draining that makes a stop polite in the first place.
 */
export function watchForShutdown(logger: Logger = consoleLogger): void {
  const current = state();
  if (current.watching) return;
  current.watching = true;

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => stopPanel(logger));
  }
}
