# The precision a date carries

2026-08-31

A deck row filed at about ten in the morning read `14h ago` on a panel opened
that same evening. Nothing had been waiting fourteen hours. Upstream publishes a
backlog row's start at day precision - the line reads `(since 2026-08-31)` and
carries no time - and the panel widened that to midnight UTC and counted hours
from there. Fourteen and a half hours is the distance from a midnight the record
never stated. The number was not a duration; it was an artefact.

This is the defect this project keeps catching, in its quietest form: a claim
made more precisely than the evidence behind it. It is also self-worsening. The
same row read more wrongly the later in the day it was looked at, and worst in
the evening, which is exactly when an operator opens the panel to see what has
been sitting too long.

Note what this is not. The seam that produced document version 4 made an
**absent** start date representable - `since: null`, and the row says "no start
date" rather than being stamped with the moment upstream happened to look. That
was right and it stays. This is the neighbouring case: the date is present, and
simply coarser than the rendering pretended.

## The document already had the shape; the projection was throwing it away

The first question was whether the document could express the difference between
"this record carries a day" and "this record carries an instant" at all, because
if it could not, the honest move is a version bump rather than a guess about a
string's shape.

It could. The seam's idiom for a day is already the bare `YYYY-MM-DD` string:
`Hold.deferredTo` carries one, `LandedItem.landedOn` carries one, and the landed
lens deliberately draws that date with no age beside it, "because it is a
calendar day rather than an instant". The projection was the only place a day
stopped being a day - `sinceOf` in `src/domain/project.ts` interpolated
`T00:00:00.000Z` onto it, and every reader downstream inherited a time nobody
had recorded.

So `sinceOf` now carries the day verbatim, an instant verbatim, and `null` for
anything that is neither. `DeckItem.since` has **two declared forms**, and
`docs/contract.md` says so. A renderer telling them apart is reading the
contract, not guessing from a string: the widening was the guess.

`DOCUMENT_VERSION` was deliberately **not** bumped. The TypeScript shape is
identical, the slot is the same one two other fields already use for a day, and
a reader that ignores the distinction lands on `Date.parse("2026-08-31")` -
midnight - which is precisely the behaviour being replaced, so an unaware reader
degrades to today rather than breaking. A bump would also have to be shared with
the other work queued against the seam.

## The rendering: one helper, day arithmetic only

`agoAtPrecision` in `src/ui/lib/age.ts` sits beside `ago` and delegates to it
for anything carrying a time. A day gets `since today`, `yesterday`, `Nd ago`,
`Ny ago` - and the count comes from **whole calendar days**, never from hours
divided by twenty-four. That is the property that makes the fix hold: there is
no hour in the arithmetic to leak into the phrasing, so the row reads the same
at 00:30 and at 23:30.

The day is read in the panel's own calendar rather than UTC. Upstream's date is
the day the operator wrote, on the machine this panel runs on, so their midnight
is the boundary that makes "today" mean today. Reading it as UTC would recreate
the same defect in miniature: everywhere west of Greenwich, an operator's own
afternoon work would file itself as "yesterday" once the clock passed their
evening. The trade is that the panel and the fleet must share a calendar, which
they do - the panel reads a fleet home on the same machine.

A date ahead of the clock reads `since today` rather than a negative age.
Fixtures are dated ahead of the wall clock on purpose so they never drift into
looking stale, and `ago` answers `just now` for the same reason.

## What was swept, and what was left alone

This narrows one claim; it must not blunt claims that are already honest. Every
other age on the page was traced to its source:

| Age                                                 | Source                                                           | Verdict                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `DeckItem.since`                                    | upstream's backlog line, usually a bare day                      | **Fixed** - the defect.                                                    |
| `LandedItem.landedOn`                               | upstream's `completion.date`, a day                              | Already right: the landed lens prints the date and draws no age beside it. |
| `Hold.deferredTo`                                   | upstream's `hold_until`, a day                                   | Already right: printed as a date, never as an elapsed time.                |
| `Lifecycle.observedAt`                              | upstream's `current_state.observed_at`, through `requireInstant` | A real timestamp. Unchanged.                                               |
| Every `LensStatus.asOf` / `observedAt`              | the snapshot's `generated`, or the panel's own clock             | Real instants. Unchanged.                                                  |
| `PanelDocument.generatedAt`                         | the panel's clock at assembly                                    | Real. Unchanged.                                                           |
| `SupervisorSignal.lastSeen`, `Overdue.waitingSince` | file modification times, read by the health module               | Real. Unchanged.                                                           |
| `ChecksSignal.asOf`, `ReviewSignal.asOf`            | the moment the forge was read                                    | Real. Unchanged.                                                           |

## The ripple worth stating

`DeckItem.since` is one of the five fields digested into an answer record's
request id (`requestIdFor`, `src/adapters/intent.ts`). A day-precision row now
digests `2026-08-31` where it used to digest `2026-08-31T00:00:00.000Z`, so such
a row's request id changes once, at the deploy.

That costs nothing that matters. The identity is derived so that a double click
collides rather than filing twice, and it still does - every reader of the same
document derives the same name. The only thing lost is collision across the
deploy boundary itself, for a hold that was answered before it and re-answered
after. The alternative - keeping a fabricated midnight in the document purely to
stabilise a hash - would be preserving the defect to protect a digest, which is
the wrong way round.

## What holds it shut

`tests/deck-age.test.ts`. The unit cases assert every claim at eight hours
spread across the day, including the late evening where the old behaviour was
worst - a test of this that only ran in the morning would have passed against the
bug. One case pins `14h ago` as the output of the old widening, so a change that
quietly restores it fails here rather than in a fleet digest comparison months
later. The end-to-end case drives `upstream-shape`, whose backlog rows carry a
bare day, through the built server at two pinned hours of the same day, with the
server's own calendar pinned rather than inherited from whoever runs the suite.
