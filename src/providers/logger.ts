/**
 * Logging, as a dependency.
 *
 * Nothing outside this file calls `console.*`. A panel that logs from twenty
 * scattered places cannot later be made quiet, structured, or routable without
 * touching twenty files.
 */
export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

function line(
  level: string,
  message: string,
  fields?: Record<string, unknown>,
) {
  const suffix = fields ? ` ${JSON.stringify(fields)}` : "";
  return `[quarterdeck] ${level} ${message}${suffix}`;
}

export const consoleLogger: Logger = {
  info: (m, f) => console.info(line("info", m, f)),
  warn: (m, f) => console.warn(line("warn", m, f)),
  error: (m, f) => console.error(line("error", m, f)),
};

/**
 * The one message Next prints that is not a fault, said plainly instead.
 *
 * React's Flight serializer pipes a render into the response and listens on the
 * far end of it. If that end closes while the render still has work
 * outstanding, it reports `The destination stream closed early.`, and Next
 * prints it as a red `⨯ Error` with a digest. On this panel that sentence has
 * exactly one meaning: a page went away while the server was still building the
 * refresh it had asked for. Every reload, every closed tab and every restarted
 * panel does it, the page that left is not there to receive anything, and
 * nothing on the server is in a worse state for it.
 *
 * It is claimed here rather than tolerated because an operator cannot be asked
 * to learn which red errors to ignore - a panel that prints one on a healthy
 * start has spent the only signal it has. What was a stack trace becomes one
 * plain line saying what happened. Exactly this message is claimed and nothing
 * else: every other argument `console.error` is given goes through untouched.
 *
 * The console is wrapped rather than the error suppressed upstream because Next
 * offers no way to refuse it. `onRequestError` is told about it and cannot stop
 * it being printed, and the render it comes from is Next's own - the panel
 * never holds that stream. See
 * `docs/decisions/2026-09-01-the-error-that-is-a-page-leaving.md`.
 */
const A_PAGE_LEFT = "The destination stream closed early.";

/** Set on the console once wrapped, so a second call adds no second wrapper. */
const CLAIMED = Symbol.for("quarterdeck.aPageLeavingIsNotAnError");

/** Only the part of the console this file replaces. */
type ErrorSink = { error(...args: unknown[]): void };

type Claimed = ErrorSink & { [CLAIMED]?: true };

function isAPageLeaving(value: unknown): boolean {
  return value instanceof Error && value.message === A_PAGE_LEFT;
}

export function explainPagesThatLeave(
  sink: ErrorSink = console,
  logger: Logger = consoleLogger,
): void {
  const claimed = sink as Claimed;
  if (claimed[CLAIMED]) return;
  claimed[CLAIMED] = true;

  const passThrough = sink.error.bind(sink);
  sink.error = (...args: unknown[]) => {
    if (args.some(isAPageLeaving)) {
      logger.info(
        "a page stopped listening while the panel was still rendering its refresh; nothing was lost",
      );
      return;
    }
    passThrough(...args);
  };
}
