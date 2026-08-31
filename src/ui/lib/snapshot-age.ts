/**
 * How old a snapshot may get before the panel stops calling it current.
 *
 * The one judgement the shell makes that the document does not make for it, and
 * the reason it is a number in a named file rather than a feeling spread across
 * a component: this page is a picture taken at an instant, and every card on it
 * inherits whatever this says about that instant. A threshold written inline
 * beside a colour is a threshold the next reader has to find twice.
 *
 * Two numbers, three states, and the states are deliberately coarse. The panel
 * is read at a glance and the only question it has to answer here is "may I act
 * on what I am looking at" - which has three useful answers and not five.
 *
 *   - `current`  under five minutes. A supervision cycle comes round inside
 *                this, so a snapshot this age is one nobody has had time to
 *                overtake. A snapshot under a minute old is this state too;
 *                there is nothing a fourth step could tell an operator that
 *                would change what they do next.
 *   - `ageing`   five minutes and over. Long enough that a worker could have
 *                moved, a decision could have been answered elsewhere, or a
 *                pull request could have landed since the picture was taken.
 *   - `old`      thirty minutes and over. Long enough that the panel is not
 *                describing the fleet any more, it is describing a fleet.
 *
 * This is not the same judgement as `staleAfterMs` in `src/config/`, and the
 * two must not be folded together. That one is upstream's promise about the
 * snapshot's content and it darkens a lens; this one is about how long ago the
 * page in front of the operator was assembled, and it never hides anything.
 */

/** Five minutes: past this the picture is shown, and marked as ageing. */
export const SNAPSHOT_AGEING_AFTER_MS = 5 * 60_000;

/** Thirty minutes: past this the picture is shown, and marked as old. */
export const SNAPSHOT_OLD_AFTER_MS = 30 * 60_000;

/** The same two thresholds in the badge's own words, so the copy cannot drift. */
export const SNAPSHOT_AGEING_AFTER_LABEL = "five minutes";
export const SNAPSHOT_OLD_AFTER_LABEL = "thirty minutes";

export type SnapshotAge = "current" | "ageing" | "old";

/**
 * Which of the three a snapshot assembled at `generatedAt` is.
 *
 * A snapshot dated ahead of the clock reads as `current` rather than as an
 * error: the fixtures are dated in the future on purpose so they never drift
 * into looking old as the repository ages, and a negative age is not a fact
 * about the fleet worth drawing a fourth state for.
 */
export function snapshotAge(generatedAt: string, nowMs: number): SnapshotAge {
  const ageMs = nowMs - Date.parse(generatedAt);
  if (ageMs >= SNAPSHOT_OLD_AFTER_MS) return "old";
  if (ageMs >= SNAPSHOT_AGEING_AFTER_MS) return "ageing";
  return "current";
}
