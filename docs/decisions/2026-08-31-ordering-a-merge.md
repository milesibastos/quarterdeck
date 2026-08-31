# Ordering a merge: the panel records, the guarded command merges

Date: 2026-08-31
Status: accepted

## Context

A pull request that has gone green and is waiting for somebody to press the
button is the second-most expensive silence a fleet produces. It looks finished
on every board, nothing is blocked on anybody by name, and it sits.

The captain's ruling of 2026-08-29: "V1 acts, it does not only show. The merge
button and the decision options on the main screen are real, not decoration."
The decision half shipped as
`docs/decisions/2026-08-30-answering-a-held-decision.md`. This is the other half,
and everything in that decision's safety model applies here unchanged.

The fleet already has exactly one command that merges: `bin/fm-pr-merge.sh
<task-id> <pr-url>`. Its header is a list of refusals - an outcome it cannot
prove, a merge queue whose method the caller did not name, an unresolved
discussion, a head that moved between the read and the merge, a rules response
that could not be read. Each one is a case where landing the work would be
wrong, and each one is enforced live, against the forge, at merge time.

## Decision

**The panel never merges.** Pressing the button writes one durable record and
stops. The fleet's registered process-event source reads it on its next check
and runs the guarded command, which decides for itself whether the merge may
happen. If it refuses, the refusal is reported as it wrote it; the panel never
works around it, never retries it, and never reimplements a condition it
enforces.

This is not caution, it is the whole guarantee. A panel that merged directly
would be a second authority beside that command, and every rule behind it would
hold for every channel except the one that skipped them. The panel could not
merge directly even if it wanted to: no file in `src/` may import
`child_process`, and `npm test` checks it.

**A merge order is the merge command's argument list.** The record is
`<task-id>\t<pr-url>` and a newline, named `<32 hex>.merge-order-v1`. It carries
nothing about the checks, the review, the branch or the operator's confidence,
because none of that is something the command would be entitled to trust from
here - it reads all of it live.

**The address is the full URL, never a bare number.** On the record and on the
card. `#406` is only a pull request once you have decided which repository it is
in, the panel shows several projects at once, and the command resolves the owner
and repository out of the address it is handed. A number would have to be
resolved against a repository somebody guessed at.

**One writer, one union.** `src/adapters/intent.ts` stays the only file in the
repository permitted to write. The seam task shaped the intent record as a
discriminated union with a per-kind format table, and the merge order is a
member and a row - no field of an answer redefined, no second file that writes.

**A card appears only over work that is genuinely ready.** Three clauses: there
is a pull request, it is open, and somebody has read its checks and they passed.
Nothing about the lifecycle stage, the delivery contract or the review is in the
rule, because those are the fleet's semantics and its command reads them live.

Checks that are `not-looked-up` or `unreadable` are **not** merge-ready. Reading
the forge is opt-in and off the first paint
(`docs/decisions/2026-08-31-reading-the-forge.md`), so a panel started without it
shows no merge cards at all - which is correct. A button over a reading nobody
took would be the panel implying a green run it has not established.

## The world is re-checked at the moment the order is acted on

This is the one place this decision goes further than its sibling, and it is
worth saying why the two differ.

An answer to a held decision is inert on its own: the intake skips a key naming
no task, a task not held for a person, and a task already closed. Filtering
stale answers in the panel would buy nothing, so the panel does not try. A merge
order sits differently only because of what the page promised while the operator
was looking at it. The card said "green, open, six of six" - and the panel
re-renders on a change signal, not on a clock, so the page in front of them may
be minutes old.

So the acting route re-reads the fleet - not the cache; `FleetRuntime.reread()`
exists for exactly this - and refuses unless that fresh reading still says what
the card said: the same work item, the same address, still open, still green.
A reading that is stale, unreadable, or in a schema this build does not
understand is a refusal too. "I cannot confirm" is a changed world as far as an
order to merge is concerned.

**This is not the panel deciding a merge is allowed.** It is the panel declining
to carry an order whose premise it can already see has expired. Everything that
actually decides is still read live by the guarded command, after this.

## The identity is the task and the address, and nothing that moves

`<32 hex>` is the digest of the task id and the pull request address. That makes
a double click, a retry and a second tab the same order by construction, which
is the property acceptance asked for and the reason the identity is derived
rather than minted.

Nothing else could go in it. The checks' `as_of` moves every time the forge is
read - at most once a minute, per pull request - and a head commit is not
something the document carries at all. Either in the digest would mint a fresh
name for the same order and quietly cost it its replay protection.

The cost is real and is stated rather than hidden: **a second press after the
fleet has taken the order is a duplicate**, and the panel says the order was
already recorded rather than ordering the merge again. If the guarded command
refused and the operator fixes whatever it named, re-ordering is the fleet's to
offer - it is the side that knows the first order was consumed and how it ended.
The panel minting a new name to force a retry would be the panel deciding that
the earlier refusal no longer applies, which is precisely the judgement it has
no standing to make.

## The panel never says anything merged

After a press, the card says the order was recorded and that the fleet will act
on it at its next check, then says plainly that it cannot say anything merged
until a later reading shows it.

It would be one word's work to write "merged" and be wrong. Five bugs in this
project have already been the panel asserting something it had not established,
and this is the easiest place left to make that mistake and the worst. The
sentences are pinned in `src/ui/needs-you/merge-copy.ts` and asserted in
`tests/merging.test.ts`, because a client component's copy never reaches the
server-rendered page and no test that reads HTML could hold it.

## Trade-offs

**The fleet-side adapter does not exist yet.** Same as its sibling: a record
written today is picked up by nothing until a `bin/fm-procevent-*` adapter with a
merge command is armed and bound. The format above is the contract that adapter
gets built against. Until then the panel is honest - it says the order was
recorded, which is true.

**A stale fleet reading costs a refusal, not a merge.** The card is offered from
whatever the band last drew, including a fleet lens showing last-known-good
after a failed read. Pressing it then gets an explanation instead of an action.
That is the right way round: the alternative is either hiding merge-ready work
whenever a read hiccups, or passing on an order backed by a picture the panel
has already stopped trusting.

**Re-reading on the acting path costs one snapshot read per press.** Bounded by
the same read timeout as every other read, and it happens once, on a deliberate
human action. Nothing publishes a change signal for it: a re-read is not a
change, and waking every open page because somebody pressed a button would be
the panel inventing traffic.

## See also

- `docs/decisions/2026-08-30-answering-a-held-decision.md` - the sibling, and the
  safety model this inherits whole.
- `docs/decisions/2026-08-31-reading-the-forge.md` - why a checks reading is
  opt-in, and why `not-looked-up` is the ordinary answer rather than a failure.
- `src/adapters/intent.ts` - the only file permitted to write, and the whole of
  the panel's side of this.
