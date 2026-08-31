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

| Recorded as | Stages | Length |
| --- | --- | --- |
| build, `validated` | dispatched, working, validating, pull request open, in review, landed | 6 |
| build, `direct-pr` | dispatched, working, pull request open, in review, landed | 5 |
| build, `local` | dispatched, working, validating, landed | 4 |
| research | dispatched, working, landed | 3 |

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
floating beside it: a halted worker naming a pipeline step was validating when
it stopped - the steps only run there - so its marker lands on that rail's
validating stage, wherever that stage happens to sit.

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

**A pipeline step does not.** The step is a word this panel's own projection
fished out of upstream's prose with a first-match rule; the contract was written
down at dispatch. So a worker naming a step on a rail with no validating stage
keeps its recorded rail, and the panel declines to place the stop or to number
the step out of nine - both of those frame the nine-step pipeline that the
contract says was skipped. Upstream's own line is drawn under the rail
regardless, so nothing the operator needs is lost.

**Everything the pips say is in the sentence below them.** The track is
`aria-hidden`, so "stage 3 of 4" and "stage 3 of 3, the last of this rail" are
what carry the shape. That sentence is also the only thing that distinguishes
finished three-stage work from a worker halfway down a longer rail: three lit
segments look the same either way.

## Consequences

**A stop on a rail with no validation cannot be placed.** A held direct-pr or
research worker names no pipeline step it could be anchored by, and there is no
other evidence of where it stopped: `Lifecycle` carries the stage a worker is in,
not the stage it was in before it stopped. A `lastActiveStage` upstream would
close this, and it is the same gap `src/ui/fleet/fleet-lens.tsx` already names.
The rail is drawn at its right length and left unlit, which is the conservative
end of it.

**A pull request was rejected as a second anchor.** A worker that has one has
demonstrably reached the pull request stage - but "reached" and "stopped at" are
different claims, and the marker makes the second. A worker blocked during
review has a pull request, and pinning its stop to the pull request stage would
misplace it.

**Fixtures had to become coherent.** Three fixture workers were investigations
standing on stages an investigation cannot reach, and one was a direct-pr worker
in validation. All four were incoherent before this change and simply did not
show it. They are fixed; `fixtures/rails/` carries every shape in its working,
stopped and finished states, plus both ways a rail's length can be unknown, and
one deliberate contradiction so the fallback has a witness.

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
