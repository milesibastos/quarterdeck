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

/**
 * The depth at which the notification queue has stopped draining.
 *
 * The document carries a depth rather than a verdict, deliberately: reading a
 * number as a problem is this lens's judgement and nobody else's. A queue is a
 * pipe, so items sitting in it is ordinary - what is not ordinary is a pipe
 * that keeps filling, and four is where upstream's own note puts that line.
 *
 * Four rather than one because a fleet raising a notification and delivering it
 * a moment later is the queue working; a queue that has been holding four is
 * arriving faster than it is handled. The comparison is `>=`, so a queue
 * holding exactly this many has already crossed.
 */
export const QUEUE_BACKED_UP_AT = 4;

/** The same threshold in the lens's own words, so the copy cannot drift from it. */
export const QUEUE_BACKED_UP_AT_LABEL = "four";
