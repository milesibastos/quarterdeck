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
