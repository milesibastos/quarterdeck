# The stage a stop happened in

2026-09-01

## The question

A rail exists to answer one question about a stopped worker: where was it when
it stopped. Until now the panel could only answer it in one place.

`Lifecycle` carried the stage a worker is in - `held`, `blocked`, `waiting`,
`failed` - and no record of the stage it was in before. The rail recovered a
position by deduction: the validation pipeline's nine steps only run inside the
validating stage, so a stopped worker whose detail named one was validating when
it stopped. That deduction needs a validating stage to land on. Two of the four
rails do not have one - `direct-pr` skips the pipeline and `research` never
enters it - so on those a stop was drawn at the right length with no position at
all.

The panel never lied about it. It said "position not known" in words rather than
leaving an unlit rail to be read as a claim. But an honest blank is still a
blank, and it was the blank sitting exactly where the question is.

## What upstream publishes

**Nothing.** Checked on 2026-09-01 against two live fleet homes rather than
assumed, because the two passes that recorded this gap before recorded it
without establishing it.

```sh
# Run once per configured fleet home, from that home. Two were checked.
FM_HOME=<a fleet home> bin/fm-fleet-snapshot.sh --json
```

Across both homes, every task's `current_state` object carries exactly six keys:

```text
detail  freshness  observed_at  raw  source  state
```

There is no prior stage, no last active stage, and no history of any kind. Two
further checks say the same thing from the other direction:

- `grep -rn 'pr_open\|in_review\|waiting_external\|last_active\|prior_state\|previous_state' bin/`
  in a fleet home matches nothing. Upstream does not have the vocabulary to
  publish a rail stage, let alone a prior one.
- `bin/fm-crew-state.sh` declares the whole vocabulary in its own header, at
  line 18: `state: <working|parked|done|blocked|paused|failed|unknown>`. Seven
  reconciled states, of which exactly one - `working` - is a place on the rail.
  The document's other five active stages are mapped from context, not read.

One of the two homes made the gap concrete at the moment of the check. It was
running a single worker, recorded as `mode=direct-PR` and reconciled to
`paused` - a stopped worker on the rail that has no validating stage. Its detail
was a person's sentence saying a pull request had been updated and was waiting
on a merge decision.

So the detail plainly implied where that worker stopped, and the panel still
could not name it. Reading it would mean inferring a rail position from free
prose, which is what this project already refuses one layer down - the sentence
is a status note somebody typed, not a field.

## What was decided

**The document carries the stage, and never computes it.** `Lifecycle` gains
`lastActiveStage`, an `ActiveStage | null`, filled from
`current_state.last_active_state` in the upstream contract. Document version 5.

Three properties, each load-bearing:

**Carried, never derived.** The document seam refused a prior-stage field the
first time precisely because everything it could have held was computable from
the field beside it, and a field computed from another field drifts the moment
the computation changes. That objection has not been answered by a better
derivation - it has been answered by upstream being the only party allowed to
fill it. Nothing in `src/domain/` works this value out; the projection maps
upstream's spelling to the document's and stops.

Deriving it in the projection would also be worse than it looks. The projection
cannot see which rail a worker has, so it would happily assert `validating` for
a worker whose delivery contract skips the pipeline, and never know that its own
answer was impossible.

**An active stage, never a halted one.** `SnapshotActiveState` is its own type -
the six of upstream's states that are places on the track. "Where was it
standing" cannot be answered with "it had stopped": a worker that was held and
is now blocked has not moved along the rail, so a halted value here would say
nothing the `stage` beside it does not already say.

**Accepted, not required.** Absent and `null` are one thing - a fleet with
nothing to say - which is not a snapshot to refuse. Present and unrecognised is
a different thing and is refused, like every other computed field in this
parser: it is upstream's own assertion about a position, and a spelling this
build does not know is a meaning it would be guessing at.

This is the arrangement `branch`, `model`, `effort` and `brief` already have,
with one difference worth stating. Those are recorded at dispatch and merely not
carried out to the snapshot; this one is recorded nowhere at all. So it is a
slot a finer upstream can fill without the parser changing, rather than a field
waiting to be plumbed through.

## What the rail does with it

`reachedIndex` now tries three answers in descending order of what they are
worth: the worker's own stage if it is on the track; then the anchor, because
upstream watched the worker and wrote down where it was; then the old step
deduction. The anchor is the only one of the three that reaches a rail with no
validating stage, which is the whole of why the gap closes.

Three details decided rather than fallen into:

**The anchor is only ever asked of a stopped worker.** `unseen` is not a stop -
it is the panel saying it cannot see the worker at all - and a worker the panel
has lost sight of must not be placed on the track by a record that came from
somewhere else, however confidently that record asserts. An on-track worker is
not asked either: its position is the stage it is in, and where it was before
that is behind it.

**A step is framed as a pipeline run only when the stop is anchored inside
validation.** Printing "step 3 of 9" beside "with its pull request open" would
claim the worker was in the pipeline at the moment it stopped, when upstream
said it was somewhere else. Upstream's own line is drawn under the rail either
way, so the step word is never lost - only the frame the panel would have put
around it.

**An anchor the recorded rail has no room for drops the rail.** A worker
recorded as `direct-PR` and reported as having stopped in validation is two
upstream facts contradicting each other - the same class of disagreement the
mismatched-stage test already surfaces. Quietly ignoring the anchor would hide
the contradiction and lose the position with it, so it falls through to the
unknown shape, and the sentence names which of the two claims had no room:
an operator chasing a stale dispatch record looks somewhere else than one
chasing a bad reading.

## What remains underivable

**On a live fleet, every stop.** Upstream fills this field for nobody, so every
real worker's `lastActiveStage` is `null` and every real stop is placed by the
old deduction or not at all. The two cases that were blank before this change
are still blank on a live fleet today:

- a stop that names no pipeline step, and
- a stop on `direct-pr` or `research`, whose prose may name a step but whose
  contract says the pipeline was skipped.

Both still say "position not known", in words. That is deliberate and is the
outcome this record is defending: a confident position with nothing behind it
would be the worse failure - it looks green and is answering from nowhere.

What changed is where the gap sits. It was a hole in the document's shape, which
only this repository could close. It is now a hole in what upstream publishes,
which upstream can close in one field without this parser, this projection or
this rail changing a line. `fixtures/rails/` carries an anchored stop on all
four shapes, so the path is drawn and tested rather than waiting to be written.

**Not attempted.** Reconstructing a prior stage from the status log's event
history. `paths.status_log.last_event.state` is a crewmate's own report verb -
`working`, `paused`, `done` - which is a different vocabulary answering a
different question, and reading a rail position out of the accompanying prose is
the inference this whole record exists to refuse.

## Alternatives rejected

**Anchor a stop to the rail's `working` stage when its prose names a step.**
Tried during the four-rails work and reverted. On a rail whose contract skips
the pipeline, the step word evidences nothing about which stage the worker
stopped in - and it walks a worker held after its pull request opened backwards
to `working`.

**Anchor a stop to `pr-open` when the worker has a pull request.** A pull
request proves a worker REACHED that stage; a position claims it STOPPED there,
and those are different claims. A worker blocked during review has one and did
not stop at `pr-open`.

**Leave the document alone and disclose the gap harder.** It had already been
disclosed twice, in `docs/quality.md` and in the four-rails record, and carried
twice. Disclosure is what you do with a gap you cannot close; this one had a
one-field close available, and the disclosure was standing in for it.

## See also

- `docs/decisions/2026-08-31-four-rails.md` - the four shapes, and acceptance 3
  of that task, which this makes true rather than aspirational.
- `docs/contract.md` - the field, the version history, and the commands above.
- `docs/quality.md` - what a live fleet fills, and what it does not.
