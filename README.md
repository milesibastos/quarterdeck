# quarterdeck

A local command panel for a firstmate fleet: what needs the operator
personally, what is running now, what is queued or stuck, and whether the
machinery supervising it all is healthy.

The needs-you band owns the first screen and offers a control to answer each
decision held for a person. Below it, the fleet lens draws a worker card and
lifecycle rail per piece of work under way - a card also opens that worker's
terminal on demand, read only and never on the first paint, see
`docs/decisions/2026-08-31-the-worker-terminal.md` - the deck lens draws what
the fleet is handling by itself, the landed band draws what finished and which
home finished it, and the shipshape lens draws the five health signals and its
own dark state. A disclosure bar closes the page, naming every absence the
document declares and which of three reasons it has - see
`docs/decisions/2026-08-31-landed-work-and-the-disclosure-bar.md`. All of them
read from a configured fleet home, or from a synthetic fixture fleet when none
is configured - see `fixtures/README.md` for `QUARTERDECK_FLEET_HOME`. An
operator with more than one configured fleet picks which they are looking at,
and their browser remembers it. The panel still executes nothing: answering a
decision writes a durable record for the fleet to pick up, never a command the
page runs itself - see
`docs/decisions/2026-08-30-answering-a-held-decision.md`.

## Run it

Requires Node 24.

```sh
npm install
npm start          # builds if needed, then prints the URL it bound
```

The port is derived from this worktree's absolute path, so two checkouts can run
side by side and each always answers on the same URL.

### The panel's port changed, and your bookmark is stale

Panels used to answer in 45000-45999. They now answer in 28000-28999, so every
URL derived before that move is gone and a bookmark to one will not connect.
Nothing is wrong with your checkout.

`npm start` prints the URL it bound, every time - that line is the current
answer, and it always has been.

If you would rather have a URL that no future move can take away, pin one:

```sh
QUARTERDECK_PORT=28123 npm start   # this checkout, this port, always
```

Set it per checkout - in your shell profile, a direnv file, whatever you
already use - and the derivation is skipped entirely. Two checkouts pinned to
the same port cannot run at once: the second refuses to start, names the port,
and tells you to stop the other one or set `QUARTERDECK_PORT`.

The band moved because 45000-45999 sits inside the range Linux hands out
ephemeral ports from, so on Linux the kernel could be holding a panel's port
before the panel bound it. 28000-28999 is under that floor, under the range
Kubernetes allocates NodePort services from, and clear of the band this
repository's own test suite uses. The ranges and where each was read from are
in `docs/decisions/2026-09-01-the-panel-band-clears-every-kernel.md`.

```sh
QUARTERDECK_FIXTURE_SET=stale npm start   # see fixtures/README.md for the sets
npm test                                  # lint, invariant checks, built server
```

### When the fleet is slower than the budget

Reading a real fleet means running its snapshot command, and that command costs
roughly a second per live worker, in series. A large or busy fleet outruns the
default 20-second budget; the panel then says `Timed out` on the three lenses
that come from the snapshot - not `Could not be read`, because a fleet that is
merely big is not a fleet that is broken - keeps whatever it last read cleanly on
screen, and asks again after a pause proportional to what the attempt cost.

```sh
QUARTERDECK_READ_TIMEOUT_MS=45000 npm start   # a fleet with a lot of workers
```

Raising it is the direct answer, and it is bounded by taste rather than by
anything mechanical: a budget approaching the 60-second staleness window buys a
read that is already stale when it lands. The measurements behind the default,
and the two problems that are upstream's rather than this panel's, are in
`docs/decisions/2026-09-01-the-fleet-read-budget-and-what-a-timeout-means.md`.

### Letting the panel answer and merge

The two controls the panel offers - answering a held decision, ordering a merge -
each write one record to a directory the operator names. Until one is named the
controls say so on the card rather than pretending they can act.

```sh
QUARTERDECK_FIXTURE_SET=healthy:stale \
QUARTERDECK_INTENT_DIR=/absolute/path/to/healthy-spool: \
  npm start
```

`QUARTERDECK_INTENT_DIR` is a colon-separated list positionally aligned with the
fleet list - the same convention `QUARTERDECK_FLEET_HOME` and
`QUARTERDECK_FIXTURE_SET` use, one slot per fleet in the order written. Above,
the first fleet has a spool and the second's slot is empty, so `healthy` offers
both controls and `stale` says it has nowhere to record an answer. There is no
single value for the whole panel on purpose: broadcasting one directory across
every fleet is what would let an answer meant for one land in another's.

Each fleet's spool must be the directory that fleet's own reader watches; the
panel is told it and never derives it from a fleet home. Nothing reads these
records today: firstmate ships no adapter for either format, so an operator who
has not built and armed one themselves gets a record on disk and nothing
further. What lands there is one line per record and nothing else, and the panel
executes nothing either way - the acting is a fleet command's to do. The exact
bytes of both formats are in `docs/contract.md`, and why the path is shaped this
way is in `docs/decisions/2026-08-30-answering-a-held-decision.md` and
`docs/decisions/2026-08-31-ordering-a-merge.md`.

## The same fleet in a terminal

`quarterdeck-tui` is the panel's terminal half: a list of the fleet's work in
progress, and one key that hands this terminal to the selected work item's
own no-mistakes screen. It is a Go program under `tui/`, separate from the web
panel and sharing no code with it.

```sh
npm run tui        # reads QUARTERDECK_FLEET_HOME, or the fixtures with none
npm run test:tui   # the Go tests; CI runs them in a job of their own
```

Both are thin wrappers around `go -C tui`, which needs a Go toolchain and
nothing else. Nothing is compiled into the tree.

`up`/`down` or `j`/`k` move, `enter` opens the selected work item's
no-mistakes run, `r` re-reads the fleet, and `q` or `ctrl+c` leaves. The list
also re-reads itself every few seconds and again whenever no-mistakes hands the
terminal back, because what you just watched may well have moved the fleet.

It reads the same fleet the web panel does, through the same command - the
snapshot a fleet home publishes - and honours `QUARTERDECK_FLEET_HOME`,
`QUARTERDECK_FIXTURE_SET`, `QUARTERDECK_FIXTURE_ROOT` and
`QUARTERDECK_READ_TIMEOUT_MS` as the panel defines them. With several fleets
configured it opens the first: choosing between them is the web panel's.

**It only reads.** No answer, no merge order, no instruction to a worker,
nothing written anywhere, and the shared no-mistakes daemon is never started or
restarted. The one thing it runs on purpose is `no-mistakes attach`, on Enter,
with whatever ordinary effects that command has.

### What Enter can and cannot open

A work item is joined to its pipeline run by the branch firstmate dispatches it
on, `fm/<task-id>`, matched exactly and never by prefix - `demo-alpha-a1` and
`demo-alpha-a10` are different pieces of work. Firstmate publishes no run
identifier on a task, so the branch is the only thing the two sides agree
about; the runs themselves are read from `no-mistakes axi status`, which is
no-mistakes' own machine-readable surface. Where a branch has several runs, the
newest is opened.

That listing is bounded, so a run can exist and still not be in it. When
no-mistakes says the branch it is standing on has runs and none of them was
listed, the row says exactly that rather than claiming there is none.

A row is never hidden for being unopenable. A worker on another machine, a
worktree that has gone, a repository no-mistakes was never initialised in, a
run that has not started, a daemon that did not answer - each stays on the list
with its own reason in place of the action.

### What this first version is not

It navigates and it opens. There is no filtering, no mouse, no preview pane, no
steering, no merge control, no second pane and no remote attachment, and it
draws no no-mistakes screen of its own - the point is that you get the real
one. Why it is a separate program, and what the branch join costs, are in
`docs/decisions/2026-09-03-the-terminal-panel-and-the-handover.md`.

## Where things are

`AGENTS.md` is the map. `docs/ARCHITECTURE.md` has the six layers, the seven
invariants, and why each one exists.

The invariants are checked by `npm test`, not by convention: dependencies point
one direction, the projection does no I/O, exactly one file may write anything,
one file may name fleet-internal paths, the upstream contract is pinned and
refuses loudly when it changes, components read only the document, and the
browser fetches nothing from the network at runtime.
