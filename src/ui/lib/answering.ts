/**
 * How an answer reaches the server.
 *
 * Handed in from the composition point rather than looked up: `src/ui/` may not
 * read the runtime, so the address, the header the acting guard checks and the
 * secret minted at start all arrive as a value. See
 * `docs/decisions/2026-08-30-answering-a-held-decision.md`.
 *
 * It lives here rather than beside the control that uses it because more than
 * one place needs it - the composition point mints one, the shell carries it,
 * the band hands it to a card - and a shared type owned by one lens directory
 * is a lens the other importers have to reach into for no reason.
 */
export interface AnsweringSession {
  /** The header name the acting guard checks. */
  readonly header: string;
  /** The secret minted at start. Never leaves this origin; see the proxy's CSP. */
  readonly secret: string;
  readonly endpoint: string;
}
