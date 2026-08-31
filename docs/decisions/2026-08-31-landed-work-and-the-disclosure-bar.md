# Landed work, and the bar that names what is missing

2026-08-31

Two absences from the panel, both of which the wireframe treats as defects
rather than omissions.

The first: the panel showed what is running, queued and held, and then forgot
work the moment it landed. Worse, work a second mate landed in its own home is
still the operator's work, and prior boards lost it entirely - either by only
ever looking at one home, or by merging two homes' work into one list where
nobody could tell whose fleet did what. Which is the quieter failure of the two,
because a list that has silently dropped a home looks exactly like a list that
has not.

The second: nothing on the page was responsible for saying what the page is not
showing. That is the same shape as the failure this whole phase exists to
correct - a plan that dropped seven features quietly - and a bar naming every
absence is the structural version of not doing that again.

The document seam froze both shapes before either was built: `landed` is a lens
of its own and `omissions` is a list on the document rather than a part of any
lens. See `docs/contract.md` and
`docs/decisions/2026-08-30-the-document-seam.md`. What follows is what the two
new components in `src/ui/` do with them.

## The landed band is quiet, and that is the point

It is an ordinary lens - `prominence="lens"`, no accent, no count of things to
do - and it sits below the deck. Nothing in it needs the operator: it is a
record of what the fleet already finished, and a band that competed for
attention with the one that owns the first screen would be taking back what
`docs/decisions/2026-08-31-what-needs-you-owns-the-first-screen.md` settled.

What it does say in its header is how much of what landed a mate landed - `4
landed · 3 by a mate`. A bare count cannot tell an operator whether any of it
came from a home other than the one on screen, which is the exact fact prior
boards lost.

## Every row says whose home it landed in

From `where` and `home` on the record, never from which list the item arrived
in: by the time it reaches the lens there is one list. A mate's home is shown as
the whole path upstream wrote, not its last segment - shortening it is the
picker's business, where the operator chose a fleet, and here the full path is
what tells two mates' homes apart.

A record upstream did not stamp a home onto says so - "home not recorded" -
rather than being drawn as this home's. That is the projection's rule surfacing
on screen: answering "here" for an unattributed record would attribute a second
mate's work to the fleet being looked at, which is a lie in exactly the
direction this feature exists to correct.

## Two things the row does not do

**It does not put an age beside the landing date.** `landedOn` is a calendar
day, not an instant. An age computed from it is off by up to a day and claims a
precision the hand-written record never had - and every other age on this page
answers "is this picture current", which is not a question a landing date is
about.

**It does not draw a last-known-good caveat when its lens goes dark.** The deck
draws one, correctly: its content then is the last deck that read cleanly. The
landed lens is different. It goes dark when upstream could not read the backlog,
and what survives that is a second mate's work - rolled up separately, and as
current as the read that produced it. Calling it an old picture would be a claim
about its age that nothing established. The line says only when the read failed
and that what follows is the part that still arrived.

## The bar is not a lens

It carries no `LensFrame`, no trust word and no `data-lens` handle, because it
is a statement about the page rather than a part of it. It is last on the page:
an operator who has read to the bottom has read what is missing from it.

Its three reasons stay apart, under three headings. `not-shown` is a bound
somebody chose, `not-looked-up` is a read nobody has done, `unreadable` is a
read that failed - and they ask three different things of an operator: accept
it, ask for it, or go and find out what broke. One apologetic sentence covering
all three would tell them to do nothing about any of it.

## It is derived, and composes nothing

The bar renders `document.omissions` and nothing else. It counts nothing itself,
has no list of features to check against, and writes no sentence about what is
missing. The projection assembles the list, because it is the one place that
knows both what upstream sent and what upstream declared it could not send - see
`omissionsOf` in `src/domain/project.ts`.

A bar somebody updates by hand is a bar that goes stale silently, which is the
precise failure it was built to prevent.

## "Nothing is missing" is a claim, and it is gated

An empty bar still draws, saying so plainly: a bar that disappears when nothing
is missing is ambiguous with a bar that was never built, and with a page that
forgot to render one.

But `omissions` is also empty when the snapshot could not be read at all -
`withSnapshotUnreadable` carries forward the last good list, and on a first read
there is none. The list is then empty for the worst possible reason: the read
that would have said what is missing is the read that failed. So the empty state
is gated on the snapshot's own status, taken off the fleet lens, which is the
one this page never darkens alone. Read cleanly and empty, it says nothing is
missing. Unreadable and empty, it says the page cannot account for what it is
not showing.

The corner tally is gated with it - "not accounted for" rather than "nothing
omitted". A header claiming one thing over a body saying the other is worse than
either alone, because a reader scanning the page takes the short line and moves
on. This was caught in a browser, not in a test: the first build said "NOTHING
OMITTED" above a paragraph explaining that nothing could be counted.

## What it cost

The page is one band and one bar longer, and the landed band is between the deck
and shipshape - so the health signals moved further down on a busy fleet. That
was already the accepted trade of the fold-line ruling; the age badge in the
masthead is what carries the trust signal above the fold.

The bar names an absence per unread pull request signal, which on a live fleet
is two entries every time - nobody has read the forge, because that read is
opt-in. That is verbose and it is correct: it is the honest description of an
ordinary page, and the moment it stops being said is the moment it stops being
noticed.

## See also

- `docs/contract.md` - the `landed` and `omissions` shapes, and the upstream
  fields they are projected from.
- `docs/decisions/2026-08-31-what-the-document-may-not-say.md` - the rule that an
  absence is carried as an absence rather than filled in.
- `tests/landed-lens.test.ts`, `tests/disclosure.test.ts` - both driven end to
  end through the built server.
