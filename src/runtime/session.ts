import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The session secret.
 *
 * Minted once per process start and never persisted. Acting endpoints require
 * it; reading endpoints do not. This exists from the first commit even though
 * nothing acts yet, because the moment an acting endpoint appears the guard has
 * to already be in front of it - retrofitting a guard means shipping a window
 * where there is none.
 *
 * It is never logged and never sent to the browser by this build. Handing it to
 * the page is part of the write path, which is later work.
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
