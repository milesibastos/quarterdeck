# The terminal panel, and how it hands the terminal over

2026-09-03

## What was decided

Quarterdeck gets a second front end: `quarterdeck-tui`, a Go program under
`tui/` that lists the fleet's work in progress in a terminal and, on Enter,
hands that same terminal to the selected work item's no-mistakes screen until
it exits.

It shares no code with the web panel. It reads the same fleet through the same
command and honours the same settings, and that is the whole of the overlap.

## Why a second program rather than a second lens

The panel already draws work in progress, and drawing it again is not what this
is for. What a terminal has and a browser does not is the ability to _become_
another program: an operator watching a fleet from a terminal wants the
no-mistakes screen for the run they are looking at, on the terminal they are
already looking at, and back again afterwards. That is a handover, and a web
page cannot perform one.

Everything else follows from that. The list exists to choose what to hand over
to, so it is one screen, four keys and no second view.

## Why Go, and why no shared code

Bubble Tea does the one hard part - releasing the terminal to a child process
and taking it back - as `tea.ExecProcess`, which is a published API rather than
this project's own signal handling and terminal restoration. Nothing in the
Node half offers the same thing without writing that by hand.

Sharing types across the two languages would mean a generator, a schema, or a
copy that drifts. The snapshot is already a pinned contract with a schema
identifier, checked at both boundaries, and that is the shared thing: two
readers of one published shape, each refusing the same way when it changes. The
terminal panel decodes the four fields it draws and ignores the rest, so an
upstream that adds a field breaks neither.

## Why the branch is the join

no-mistakes keys a pipeline run by the branch it ran on. Firstmate records a
worker's branch nowhere in the snapshot - a live `bin/fm-fleet-snapshot.sh
--json` carries no branch and no run identifier on any task - but it dispatches
every worker onto `fm/<task-id>` by convention. So the convention is the join,
matched exactly.

Exactly, because a prefix match makes `demo-alpha-a1` and `demo-alpha-a10` the
same work item, and the failure it produces is the worst one available: an
operator attached to somebody else's run believing it is theirs. Where a branch
has several runs the newest is opened, chosen by run identifier rather than by
listing order, so the answer does not depend on how the listing arrived.

The alternative was to have firstmate publish the run identifier. That is the
better fix and it stays available; it is upstream's change to make, and this
version does not need it.

## Which shape `axi status` answers in

`no-mistakes axi status` answers in two shapes, and the first version of this
reader knew only the second. With a run on the branch it is standing on it
describes that one run in a nested `run:` object; with none it falls back to an
overview - two scalars and a bounded table. So the ordinary case, a worker with
a live pipeline run, was the case that parsed to nothing, and the row told the
operator there was no run at the exact moment there was one. Corrected on
2026-09-04, against v1.64.0.

The object names its own branch, and that branch is matched against the row's
exactly, the same way a listed row's is. Nothing is inferred from the object
being the one this repository is standing in: `axi status --run <id>` names an
unrelated run's section `other_branch_run:`, so upstream is careful about the
distinction and so is this.

The overview stays as the fallback it turned out to be, rather than being
replaced by bare `no-mistakes axi`. That command answers with the same bounded
overview and nothing more: it never describes the current branch's run, so the
run this panel is looking for would be found only when the bound happened to
reach it. `axi status` describes that run outside the bound, which is the whole
reason to ask it.

## Why a bounded listing gets its own sentence

The overview lists a bounded number of runs and, separately, counts the runs on
the branch it is standing on. The two can disagree, and when they do the count
is the truth. So a row whose branch is counted but not listed says the run was
not among those listed rather than that there is none - the same rule the web
panel follows when it says a fleet timed out instead of saying it failed.
Different facts get different sentences.

That path is a safeguard now rather than the everyday one, because a branch
with runs is answered with the detailed object instead: every overview seen on
2026-09-04 counted zero. It is kept because the count is upstream's own and
costs nothing to believe.

The same rule reaches one shape further. A `run:` object that arrives without an
id, or without a branch, is neither a run to open nor a branch with no run: the
command was understood and its answer was short. Calling that "no run" is how
one unparsed shape became a claim about the operator's work, so it gets a
sentence of its own instead.

## What it may not do

It reads. It writes no answer and no merge order - those are the web panel's
two writes, through one file, and duplicating them here would double the
surface the safety argument has to cover. It sends no instruction to a worker.
It never starts, stops or restarts the no-mistakes daemon, which is one
instance serving every repository on the machine: restarting it would kill
other lanes' runs. That is a property of the surface it reads as well as of
this code - checked on 2026-09-03 against the installed binary, whose only
daemon-starting entry points sit under `no-mistakes daemon start`, and whose
`axi` path answers "daemon not running" rather than arranging for one.

The one thing it runs on purpose is `no-mistakes attach --run <id>`, as an
argument vector in the work item's own worktree, never through a shell, and
never without an operator pressing Enter first. A row it cannot open is never
hidden: it keeps its place on the list and says what kind of refusal it is in
place of the action, with the exact words beside the selected row.

## The cost

A refresh is one snapshot command plus one `axi status` per work item, which is
why the interval is measured in several seconds rather than in one. A fleet
whose daemon has stopped answering pays the lookup timeout per row, once per
refresh, and shows a list of reasons - which is the right failure, but it is not
free.

The two front ends can now disagree about what is in progress, because they
refresh on their own clocks. Both read the same command, so the disagreement is
never worse than the age difference between two reads. When this was written
only the web panel said how old its picture was; the terminal panel now draws a
snapshot age of its own, from the same `generated` field - see
`docs/decisions/2026-09-04-the-terminal-panels-columns-and-its-detail-block.md`,
which also replaced this version's one-sentence rows with columns and a
detail block.
