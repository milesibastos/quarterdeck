/**
 * The worker's terminal, on demand: the shape `src/ui/` renders for one card's
 * expanded tail.
 *
 * Deliberately not part of `document.ts`. The document is what the first paint
 * is built from, and this read must never touch it: a card nobody has expanded
 * costs nothing, which is the whole reason the feature is affordable. Putting
 * a tail on `Worker` would mean reading every worker's session on every pass,
 * for the eleven cards nobody opened.
 *
 * It is a `src/types/` file for the same reason `document.ts` is one: `src/ui/`
 * may import from here and nowhere else, so anything a component renders has to
 * arrive as a shape declared in this layer.
 */

/**
 * How many lines a tail carries. Fifteen, from the wireframe: enough to see
 * what a worker is saying, short enough that it is a glance rather than a
 * scrollback, and small enough that opening one is never a slow request.
 */
export const TERMINAL_LINES = 15;

/**
 * What the panel found when it looked at one worker's session.
 *
 * Four arms, and the last three are the point. A session that is gone, one that
 * could not be read, and one that has simply said nothing yet are three
 * different facts about a worker, and a panel that renders all three as an
 * empty box has merged them into a fourth thing that is not true of any of
 * them. Each arm below is rendered as itself.
 */
export type TerminalReading =
  /** The session answered, and this is what it said. Never empty; see `silent`. */
  | { readonly read: "ok"; readonly lines: readonly string[] }
  /**
   * The session answered and had nothing to say.
   *
   * A worker that has just been dispatched, or one whose pane was cleared. Not
   * a failure, and not the same thing as a session that is not there: this one
   * was found, asked, and was quiet.
   */
  | { readonly read: "silent" }
  /**
   * There is no session to read.
   *
   * The window was torn down, or the fleet has no record of one for this
   * worker. The work may well have finished; what is being reported is the
   * absence of somewhere to look, not the absence of output.
   */
  | { readonly read: "no-session"; readonly detail: string }
  /**
   * The read was attempted and failed.
   *
   * Distinct from `no-session` because the correction is different: a missing
   * session is ordinary, and a session the panel cannot read is something
   * wrong with the machinery. `detail` carries what the read actually said.
   */
  | { readonly read: "unreadable"; readonly detail: string };

/** One read of one worker's session, and when it was taken. */
export interface TerminalTail {
  /** The work item, exactly as the fleet lens knows it. */
  readonly worker: string;
  /**
   * ISO-8601 instant this read was taken.
   *
   * On every arm rather than only the successful one: a failed read still
   * happened at a time, and "could not be read, an hour ago" and "could not be
   * read, just now" are different things to be told.
   */
  readonly asOf: string;
  readonly reading: TerminalReading;
}
