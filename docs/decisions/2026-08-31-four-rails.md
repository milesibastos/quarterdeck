# Four kinds of work, four rails

Date: 2026-08-31
Status: accepted

## Context

The lifecycle rail was one fixed six-stage track: dispatched, working,
validating, pull request open, in review, landed. Every worker got all six, and
the four stages ahead of it were drawn hollow.

That is wrong for most workers. An investigation never opens a pull request.
Work delivered straight to a pull request never goes through the validation
pipeline. Work that lands locally never reaches a review. Drawing those stages
hollow tells the operator the work has somewhere still to go when it does not -
the rail says "three stages remaining" about work that is finished, and an
investigation that has written its report reads as half done.

Both facts that decide the shape were recorded when the worker was dispatched.
`Worker.kind` says research or build and `Worker.delivery` says how the work is
meant to ship; the document seam froze both in version 4, and `delivery` had no
reader until now. Because they are recorded rather than observed, the panel
knows the shape before the work starts and never has to infer it from
behaviour.

## Decision

**Four rails, each a subset of the document's own stage vocabulary.** The table
is `RAIL` in `src/ui/fleet/lifecycle-rail.tsx` and it is the only thing in the
panel that says where a stage sits.

| Recorded as        | Stages                                                                | Length |
| ------------------ | --------------------------------------------------------------------- | ------ |
| build, `validated` | dispatched, working, validating, pull request open, in review, landed | 6      |
| build, `direct-pr` | dispatched, working, pull request open, in review, landed             | 5      |
| build, `local`     | dispatched, working, validating, landed                               | 4      |
| research           | dispatched, working, landed                                           | 3      |

**Kind decides first.** A scout's delivery contract is `null` by design, and
upstream has been seen writing one anyway. An investigation carrying a shipping
contract is still an investigation, and the rail it needs is the one its work
can actually reach. Nothing about this is enforced in the projection - the
document carries what upstream said, and the lens decides what to draw from it.

**A position is read against the worker's own rail.** Validating is the third
stage of a six-stage rail and the third of a four-stage one; pull request open
is the fourth of the first and the third of a direct rail. `STAGE` no longer
carries an index, because an index is only meaningful against a particular rail.

**A stop keeps its position, and that position is rail-relative.** The stop is
still a marker pinned to the step where the work stopped rather than a status
floating beside it: a halted worker naming a pipeline step was doing that work
when it stopped, so its marker lands on that rail's validating stage, wherever
that stage happens to sit. A rail with no validating stage has nothing to land
on - see Consequences for why the panel says the position is not known there
rather than guessing one.

**An unrecorded contract draws no shape.** A build worker whose contract nobody
recorded gets the stages it has demonstrably reached, one open dashed end, and a
sentence saying how many stages the work has is not known. Never hollow stages
ahead: that is a claim about how much is left, which is the one thing this case
has no basis for. The longest rail is not a safe default - it is the drawing
most likely to be wrong, and wrong in the direction of understating what is
done.

**A stage the recorded rail has no room for drops the recorded shape.** An
investigation standing on a pull request means the record and the reading
disagree. The stage is a fact upstream reconciled and asserted, so it wins, and
the rail falls back to the unknown shape with a sentence naming the shape that
was recorded - which is what lets an operator go and look at the record.

**A pipeline step does not, and it gets no position either.** The step is a
word this panel's own projection fished out of upstream's prose with a
first-match rule; the contract was written down at dispatch, so the step must
not overrule it. A worker naming a step on a rail with no validating stage
keeps its recorded rail, and the panel claims no position for it: it declines
to number the step out of nine, to call the stop "in validation", and to place
the marker anywhere. All three would frame the nine-step pipeline that the
contract says was skipped. Upstream's own line is drawn under the rail
regardless, so nothing the operator needs is lost.

**Where the position cannot be derived, the rail says so in words.** An unlit
rail on its own reads as "this worker has no position", which is a claim. "Held
· position not known" is the truth, and it is the difference between the panel
declining to answer and the panel appearing to have answered.

**Everything the pips say is in the sentence below them.** The track is
`aria-hidden`, so "stage 3 of 4" and "stage 3 of 3, the last of this rail" are
what carry the shape. That sentence is also the only thing that distinguishes
finished three-stage work from a worker halfway down a longer rail: three lit
segments look the same either way.

## Consequences

**A stop on a rail with no validating stage cannot be placed at all.** A held
direct-pr or research worker names no pipeline step this panel may reason from -
the step word says the pipeline was running, and on a rail whose contract skips
the pipeline it evidences nothing about which stage the work stopped in. So
does a blocked or waiting worker with nothing in its prose to read, on any rail.
`Lifecycle` carries the stage a worker is in, not the stage it was in before it
stopped, and this change was not allowed to touch the frozen document seam. The
rail is drawn at its right length, and the sentence says the position is not
known. Adding the last active stage to the document, verified against a live
snapshot rather than assumed unavailable, is filed as `qd-halted-stage-r1`; it
is the same gap `src/ui/fleet/fleet-lens.tsx` already names.

**Anchoring to the rail's working stage was tried and reverted.** It is the
obvious fallback - the step says the worker was doing its work, and every rail
has a stage for that - and it is a guess dressed as a deduction. It also
misplaces work in the understating direction: a worker held after its pull
request opened would be walked back to `working` by exactly that reasoning. The
patch for that, a pull-request floor under the anchor, only made the guess
harder to see.

**A pull request was rejected as an anchor.** A worker that has one has
demonstrably REACHED the pull request stage - but "reached" and "stopped at"
are different claims, and the marker makes the second. A worker blocked during
review has a pull request and did not stop at `pr-open`. It is evidence about
the past, not about where the work is standing now, so it is not consulted at
all.

**Fixtures had to become coherent.** Three fixture workers were investigations
standing on stages an investigation cannot reach, and one was a direct-pr worker
in validation. All four were incoherent before this change and simply did not
show it. They are fixed; `fixtures/rails/` carries every shape in its working,
stopped and finished states, plus both ways a rail's length can be unknown, one
deliberate contradiction so the unknown-shape fallback has a witness, a held
investigation naming a step so the shortest rail's unplaceable stop has one, and
a held direct-pr worker whose pull request already opened - the case that proves
a pull request does not become a stop's position.

**`fleet-only` now draws mostly unknown rails.** That set records nothing at
dispatch on purpose - it is the all-absent end of every field version 4 added -
so it is the set that exercises the unknown shape across the whole stage
vocabulary.

## See also

- `src/ui/fleet/lifecycle-rail.tsx` - the rails, and the two absences.
- `docs/contract.md` - what `kind` and `delivery` promise, and their two
  different absences.
- `tests/fleet-lens.test.ts` - what of this is asserted through the built server.
- `docs/decisions/2026-08-30-the-document-seam.md` - why both facts are on the
  document rather than fetched by the lens.
