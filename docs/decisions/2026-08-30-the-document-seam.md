# The document seam

2026-08-30. Settled while freezing the document type so four workers could build
against it at once - two filling it, two drawing it.

The document is the one shape between the half of the panel that reads the
outside world and the half that draws it. Freezing it completely, before anyone
builds on it, is the whole point: a partial shape means each of the four invents
the missing fields differently and the seam quietly stops existing.

The shape itself is in `docs/contract.md`. This file is the choices that were
not obvious.

## Degradation is per lens, not per document

Version 1 had one `degraded` flag on the document. Version 2 gives each lens its
own `LensStatus`, and there is no document-wide flag at all.

The reason is that the three lenses do not have the same reliability promise.
Fleet and deck come from one upstream snapshot with a pinned schema: it parses,
or it refuses, and either way the panel knows exactly what it has. Health comes
from files that carry no compatibility promise and get moved without notice -
which is why it lives behind the quarantined module in the first place.

Two promises meeting in one document is exactly the case a single flag cannot
express. With one flag, health going dark would mark the whole document degraded
and cast doubt over a fleet that read perfectly; or, worse, it would be rounded
down to "fine" to avoid that, and the operator would never learn the machinery
lens had stopped reporting.

Per lens, all four combinations are expressible and all four have fixtures:
everything current, health dark with fleet and deck current, fleet and deck dark
with health current, and everything stale together.

**The trade-off.** Three statuses is more for a reader to handle than one, and
the shell now carries a small amount of chrome per lens rather than one banner.
That cost is paid once, in `src/ui/lens-frame.tsx`; the alternative would be
paid every time somebody had to work out which lens a document-wide flag was
actually about.

## There is no "not sharpened yet"

An earlier version of this task specified a two-pass lifecycle read: a cheap
fleet-wide call giving every worker's coarse stage, and a per-worker call giving
the exact pipeline step. The document was to carry "coarse only, not sharpened
yet" so the rail could paint immediately and sharpen card by card.

That premise turned out to be false. Upstream's single call already returns each
worker fully reconciled, fine detail included. The distinction was removed from
the document, the fixtures and the docs before anything was built on it.

`Lifecycle.step` is `null` when the stage has no finer detail to give -
`dispatched` has no pipeline step - and never because the panel has not looked
yet. A field that nothing would ever set is a field the next worker has to guess
the meaning of, which is precisely what this task exists to prevent.

## `checks` stays, though nothing sets it yet

`PullRequest.checks` is `"unknown"` for every worker today: upstream's snapshot
carries a pull request's address but nothing about its checks.

That looks like the case just deleted, and it is worth saying why it is not. The
sharpened flag had no future writer, because the two-pass read it described does
not exist. `checks` has a definite future writer - the worker who wires a real
fleet source and can read the forge - and a definite reader, the worker drawing
the fleet lens, who will want a check chip on a pull request card.

If it were absent, one of those two would add it to the document type mid-flight,
under the other three. That is the exact event this task exists to prevent, and
it is worth an honest `"unknown"` in the meantime. `unknown` is also the value
that will still be correct when the forge read fails.

The other assumptions of the same kind are listed at the end of
`docs/contract.md`, so the worker who finds one finds a list rather than a
surprise.

## No separate "where it stopped" field

The brief asked a halted worker to record which stage it stopped in, alongside
the reason. Upstream has no discrete prior-stage field: it reports one
reconciled state and a prose detail.

Anything the document could put in a `stoppedIn` field would therefore be
derived from the same detail the `step` is already read out of - a field
computable from another field, which drifts the first time the derivation
changes. `stage` says the worker stopped, `step` says where when the pipeline
named it, and `detail` says why in words. The document does not fake a fourth
answer it does not have.

## The health file has its own shape, and its own reader

Health could not come from the snapshot, because upstream does not publish it.
It is read by `src/adapters/health.ts` from a directory only that file may name,
in a shape the panel defines - so unlike the snapshot there is nothing to pin
and nothing to guess.

That also means the quarantined module now genuinely reads something, and its
contract - degrade, never throw - is exercised for the first time. The
`health-dark` fixture set has no health file at all; the panel renders three
lenses, one of which says it could not be read.

Per-signal `Unreadable` and a lens-wide `unreadable` status are both kept, and
they are not redundant. The lens status is "the health reading as a whole failed";
a per-signal value is "the supervisor was readable and the drift check was not".
The `health-unread` fixture set is that second case: a lens reporting `fresh`
whose three signals all say they could not be read.

## Lens placeholders own their directories

Each lens is one directory under `src/ui/` holding one placeholder component,
mounted by the shell and handed its own part of the document. They render a
placeholder and nothing else.

They exist so the four workers who come next each add files inside their own
lens directory and never edit a file another worker is also editing. The shell
hands each lens its `Lens<T>` from the first commit, so a worker filling one in
changes their own component's body and not the shell.

The skeleton's worker-card list and its state badge were deleted rather than
left in place: they rendered a shape that no longer exists, and leaving them
would have given the fleet-lens worker two places to work in and a vocabulary to
reconcile before starting.
