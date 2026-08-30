/**
 * quarterdeck:permitted-writer
 *
 * THE ONLY FILE IN THIS REPOSITORY PERMITTED TO WRITE ANYTHING.
 *
 * That marker line above is not decoration: `npm test` reads it. Every other
 * file is checked for write-capable APIs - `fs` mutation, `child_process`,
 * `process.chdir`, and friends - and the build fails if one appears. The whole
 * safety argument for a panel that will eventually act on a live fleet reduces
 * to reviewing this one file.
 *
 * It writes nothing yet. The write path is later work; what exists here now is
 * the shape an intent has to take before anything can act on it.
 */

/** What an operator can ask the fleet to do. Only `answer` is planned so far. */
export type IntentKind = "answer-decision";

export interface Intent {
  readonly kind: IntentKind;
  /**
   * Minted by the caller, unique per intended action.
   *
   * A retry, a double click, and a reconnecting client all resend the same
   * request. Carrying the identity on the request rather than inferring it from
   * timing is what makes acting twice impossible rather than unlikely.
   */
  readonly requestId: string;
  /** The worker the decision belongs to. */
  readonly workerId: string;
  /** The operator's answer, verbatim. */
  readonly answer: string;
}

export interface IntentResult {
  readonly requestId: string;
  readonly accepted: boolean;
  /** One line naming what happened, for the operator. */
  readonly detail: string;
}

/**
 * Not implemented. The read-only skeleton has nothing to act on, and a stub
 * that pretended to succeed would be worse than one that refuses.
 */
export async function submitIntent(intent: Intent): Promise<IntentResult> {
  return {
    requestId: intent.requestId,
    accepted: false,
    detail: "Quarterdeck is read-only in this build; no intent can be acted on yet.",
  };
}
