/**
 * How long ago, phrased for a reader.
 *
 * Coarse on purpose: an operator scanning the panel needs "is this current",
 * not a stopwatch. Computed on the server during render, so the value in the
 * markup is the value the server believed - there is no clock ticking in the
 * browser to drift out of step with it.
 */
export function ago(instant: string, nowMs: number): string {
  const seconds = Math.round((nowMs - Date.parse(instant)) / 1000);
  // Fixtures are dated ahead of the wall clock so they never drift into looking
  // stale as the repository ages. "0s ago" would be a small lie about that.
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 365) return `${days}d ago`;
  return `${Math.round(days / 365)}y ago`;
}

/** A calendar date, `YYYY-MM-DD`: a day, with no time in it. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whole calendar days from a `YYYY-MM-DD` date to the day `nowMs` falls in.
 *
 * Both sides are reduced to a day and subtracted as days, so no hour of the
 * clock and no daylight-saving shift can move the answer. The `Date.UTC` here
 * is arithmetic on already-local Y/M/D parts, not a claim that either day is
 * a UTC one.
 */
function daysSince(date: string, nowMs: number): number {
  const now = new Date(nowMs);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const [year, month, day] = date.split("-").map(Number);
  return Math.round((today - Date.UTC(year, month - 1, day)) / 86_400_000);
}

/**
 * How long ago, at the precision the record actually carries.
 *
 * The document carries a start as the record wrote it: a calendar day when the
 * operator wrote a day, a full instant when the record held one. Those are two
 * declared forms of one field - see `DeckItem.since` - so telling them apart
 * here reads the document rather than guessing at a string.
 *
 * A day gets a day-precision phrase and never an hour count. The alternative is
 * the defect this exists to stop: widen the day to midnight, count hours from
 * there, and a row filed this morning reads "14h ago" this evening - a number
 * that looks measured, is an artefact of a time the data does not carry, and
 * grows more wrong the later in the day it is read, which is exactly when
 * someone checks what has been sitting too long.
 *
 * The day is read in the panel's own calendar, not UTC. Upstream's date is the
 * day the operator wrote on the machine this panel runs on, so their midnight
 * is the boundary that makes "today" mean today; reading it as UTC would
 * recreate the same defect in miniature, filing an operator's own afternoon
 * work as "yesterday" everywhere west of Greenwich.
 */
export function agoAtPrecision(value: string, nowMs: number): string {
  if (!ISO_DATE.test(value)) return ago(value, nowMs);
  const days = daysSince(value, nowMs);
  // A record dated ahead of the clock is not aged backwards. Fixtures are dated
  // ahead on purpose so they never drift into looking stale, and `ago` above
  // answers "just now" for the same reason.
  if (days <= 0) return "since today";
  if (days === 1) return "yesterday";
  if (days < 365) return `${days}d ago`;
  return `${Math.round(days / 365)}y ago`;
}
