/**
 * The one judgement this lens makes that the document does not make for it.
 *
 * `alive` is upstream's own word and the panel carries it as given. How long
 * "last seen" may get before alive stops meaning healthy is this lens's call,
 * and it is a number rather than a feeling - so it lives here, once, beside the
 * words the lens says out loud about it. Change the number and change the
 * label with it; nothing else in the lens knows either.
 *
 * Ten minutes because supervision is a cycle, not an event: it comes round
 * often, so a gap of minutes is already a gap, while a threshold in seconds
 * would cry wolf every time a cycle ran long.
 */
export const SUPERVISION_SILENT_AFTER_MS = 10 * 60_000;

/** The same threshold in the lens's own words, so the copy cannot drift from it. */
export const SUPERVISION_SILENT_AFTER_LABEL = "10 minutes";
