# Answering a held decision: the panel records, the fleet acts

Date: 2026-08-30
Status: accepted

## Context

The deck lens shows work held for a person. Work held for a decision is the
most expensive thing a fleet does badly - it sits silently and nobody notices
for days - so the answer should be givable where the question is seen.

The fleet has exactly one keyed-answer intake, `bin/fm-captain-hold.sh answers`.
It reads `<task-id>\t<answer>\t<label>[\t<mode>]` lines on stdin and closes each
named held task through the same guarded path every other channel uses. Its
header states the rule that governs everything below: a channel's only job is to
turn whatever it received into those keyed lines. It must never map keys to
tasks, build decision records, choose a close mode beyond what its card
declared, or close anything itself.

Quarterdeck is such a channel and nothing more.

## Decision

**The page executes nothing.** Answering writes one durable record and stops.
The fleet's registered process-event source reads that record on its next check,
re-verifies the decision is still open, and feeds the intake, which owns every
rule about what an answer means.

The panel does not pipe into the intake itself. A web request must never be the
thing that spawns a fleet command, and in this build it cannot be: no file in
`src/` may import `child_process`, and `npm test` checks it. The safety argument
does not rest on the route being careful - it rests on the process being unable.

**One record is one intake line.** A record's content is exactly
`<task-id>\t<answer>\t<label>\t<mode>` and a newline. No header, no provenance
block, no timestamp. Anything else in the file would reach the intake as a
second, bogus key.

**The key is the task id, verbatim.** There is no identity arithmetic here
because the contract says there is none to do.

**The request identity is the filename.** `<32 hex>.keyed-answer-v1`, derived
from the task id, the instant the item entered its current state, the answer,
the label and the close mode. The record is published by writing to a private
staging name and then `link`ing it into place: `link` fails with `EEXIST` when
the name is taken, and that failure *is* the duplicate check. It is atomic, it
is the filesystem's own, it survives a restart, and two requests arriving at
once cannot both win it.

**Where the spool lives comes from the environment.** `QUARTERDECK_INTENT_DIR`,
read in `src/config/`. Unset means the write path is closed and the card says
so. It is deliberately not composed from `QUARTERDECK_FLEET_HOME`: which
directory the source watches is the operator's arrangement, and invariant 4
exists so this panel holds no knowledge of fleet-internal layout.

## The close mode is declared by the card, not derived

This is the one judgement call worth arguing with.

The intake takes two closes: `done` completes the held task, `release` lifts the
hold so held work resumes. A channel may only carry what its card declared.

An earlier draft derived the mode from the item's state - queued means the row
*is* the decision, so `done`; in flight means work gated by a decision, so
`release`. That is exactly the mapping the intake's contract forbids. It is the
panel inferring fleet semantics from a document that says nothing about them,
and it would be silently wrong for a queued work item held for a call.

So the card presents both closes, each with the consequence spelled out, and the
operator's press is the declaration. The channel transmits it unchanged.

## A stale answer is harmless, and not because the panel filtered it

The panel's reading is always older than the fleet's, so "is this decision still
open" is not a question it can answer. It does not try. The control is offered
on every hold that waits on a person, including one deferred to a date and one
that is also blocked, and an answer to a task the deck no longer shows is
recorded like any other.

What makes that safe is downstream and tested there: the record carries no
authority, and the intake skips a key naming no task, a task not held for a
person, and a task already closed. A replayed identical delivery is a no-op in
the intake as well as here.

The one thing the panel does check is format - a tab or a line break in an
answer is refused rather than stripped, because an edited answer recorded as the
operator's exact words is a lie, and one line cut into two reaches the intake as
a bogus key. That is format validation, not deciding whether an answer is still
wanted.

## The panel never says the decision is closed

After recording, the page says the answer was recorded and the fleet will act on
it at its next check, and then says plainly that it cannot know the call is
closed until a later reading shows it.

It would be one word's work to write "answered" and be wrong. Three bugs in this
project have already been the panel asserting something it had not established,
so the copy is asserted by a test rather than left to care.

## Trade-offs

**The fleet-side adapter does not exist yet.** A record written today is picked
up by nothing until a `bin/fm-procevent-*` adapter with an `answers` command is
armed and bound. That is deliberate: the record format above is the contract
that adapter gets built against, and building it is not this repository's to do.
Until then the panel is honest - it says the answer was recorded, which is true,
and claims nothing about the fleet acting on it beyond "at its next check".

**The session secret now reaches the browser.** The security baseline named this
as part of the write path rather than a change to it. What keeps it safe is
unchanged and tested: loopback binding, `Host` and `Origin` checked on every
request, no cross-origin sharing headers, and a CSP naming no remote
destination. The secret is not handed out at all when no spool is configured.

**A changed answer writes a second record.** The panel does not decide that a
question already has an answer - the intake does, and it rejects a decision that
contradicts the one it already recorded. Two records is the honest shape of "the
operator said two different things"; collapsing them here would be this channel
deciding what an answer means.

## See also

- `docs/decisions/2026-08-30-security-baseline.md` - the guard this lands behind,
  and the forward obligation on request identity that this discharges.
- `src/adapters/intent.ts` - the only file permitted to write, and the whole of
  the panel's side of this.
