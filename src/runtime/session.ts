import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The session secret.
 *
 * Minted once per process start and never persisted. Acting endpoints require
 * it; reading endpoints do not. This existed from the first commit even though
 * nothing acted yet, because the moment an acting endpoint appears the guard has
 * to already be in front of it - retrofitting a guard means shipping a window
 * where there is none.
 *
 * It is never logged. It does now reach the browser, in the page that carries a
 * control that acts - an answer control or a merge card - which the security
 * baseline named as part of the write path rather than a change to it: the
 * front door is what keeps it safe, and none of that moved. A fleet with no
 * intent spool configured has nothing to act on and hands out nothing. See
 * `docs/decisions/2026-08-30-answering-a-held-decision.md` and
 * `docs/decisions/2026-08-31-ordering-a-merge.md`.
 */
const SINGLETON = Symbol.for("quarterdeck.sessionSecret");

type Host = typeof globalThis & { [SINGLETON]?: string };

export function sessionSecret(): string {
  const host = globalThis as Host;
  host[SINGLETON] ??= randomBytes(32).toString("base64url");
  return host[SINGLETON];
}

export const SESSION_HEADER = "x-quarterdeck-session";

/** Constant-time, so a wrong value leaks nothing about how wrong it was. */
export function isValidSession(presented: string | null): boolean {
  if (!presented) return false;
  const expected = Buffer.from(sessionSecret());
  const actual = Buffer.from(presented);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
