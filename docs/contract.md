# Contracts

Four shapes the panel reads, the boundaries between them, and the one shape it
writes. Upstream owns the fleet snapshot, the panel owns the document and the
terminal tail, and the health file sits in between - the panel's own shape, read
from a location upstream can move without telling anyone.

`src/domain/` is the only thing that knows more than one of them.

## The document (the panel's own)

`src/types/document.ts`. The single shape `src/ui/` reads. Nothing in the UI may
reach past it, which is what makes the panel replaceable - and it is the seam
several workers build against at once, some filling it and some drawing it.

```ts
{
  version: number
  generatedAt: string              // ISO-8601, when this document was assembled
  fleet:  { content: Worker[],      status: LensStatus }
  deck:   { content: DeckItem[],    status: LensStatus }
  landed: { content: LandedItem[],  status: LensStatus }
  health: { content: Health,        status: LensStatus }
  omissions: Omission[]            // what is not on this page, and why
}
```

### The envelope: a status per lens

```ts
type LensStatus =
  | { state: "fresh"; asOf: string }
  | { state: "stale"; asOf: string; ageMs: number; detail: string }
  | {
      state: "unreadable";
      observedAt: string;
      reason: "failed" | "timed-out";
      detail: string;
    };
```

There is deliberately no document-wide `degraded` flag. Fleet and deck come from
one upstream contract that either parses or refuses; health comes from files
that may simply have moved. Two reliability promises meet in one document, so
each lens says for itself whether it is good, stale and by how much, or dark.

Every lens can carry `reason`, including health: it is read under the same
budget as the fleet snapshot, so a stalled health read times out too, not only a
slow snapshot. See version 6 in the table below for the full rationale.

`content` is always present. A stale lens still carries what it last had, and an
unreadable one carries the last thing that read cleanly - which may be nothing.
The panel never renders a blank area or an error page in place of a lens.

### The fleet part

```ts
Worker {
  id: string                       // the work item; stable, and the UI's key
  project: string
  kind: "build" | "research"
  delivery: "validated" | "direct-pr" | "local" | null
  brief:    { ref, present, summary: string | null, text: string | null }
  worktree: { ref: string, present: boolean }   // the isolated copy it works in
  dispatch: { branch, runtime, model, effort }  // each string | null
  lifecycle: Lifecycle
  pullRequest: { url, state: "open" | "landed", checks: ChecksSignal,
                 review: ReviewSignal } | null
}
```

#### What was recorded at dispatch

`kind`, `delivery`, `dispatch` and `brief` are all fixed when the worker is
dispatched, and none of them is ever inferred from what the worker is doing.

`kind` and `delivery` together are what says which rail a worker even has: an
investigation never reaches a pull request, and local-only work never reaches a
review. A lens draws the rail those two describe rather than one fixed track.

The two absences are deliberately different. An unrecognised `kind` falls back
to building, because a worker is always doing something and the fallback costs
one word. An unrecognised `delivery` is `null`, because the fallback would cost
a rail with stages the work will never reach - a drawing of progress that cannot
be true. A lens that does not know the shape draws no shape.

Every field in `dispatch` is `string | null`, and `null` means one thing: it was
not recorded. There is no second absence to tell apart here - these are not read
from the world and found missing, they are written down at dispatch or they are
not. A live fleet publishes only `runtime`; see `docs/quality.md` for what it
records and does not publish.

`brief.summary` and `brief.text` are the instructions themselves - one line for
a collapsed card, the full text behind it. The `ref` is still the pointer
upstream gives; carrying the words is what lets a card answer "what is this
worker doing" without the operator opening a file.

#### The pull request's checks and review

```ts
ChecksSignal =
  | { read: "not-looked-up" }
  | { read: "unreadable", detail: string }
  | { read: "ok", outcome: "pending" | "passing" | "failing",
      finished: number, total: number, asOf: string }

ReviewSignal =
  | { read: "not-looked-up" }
  | { read: "unreadable", detail: string }
  | { read: "ok", comments: number, asOf: string }
```

`not-looked-up` and `read: "ok"` are different facts and the panel may never
conflate them. Nobody asked the forge is not the same as the forge answered, and
`comments: 0` - asked, and nobody has commented - is not the same as not having
asked. Version 3's single `ChecksState` string could not hold that distinction:
`"unknown"` had to stand for both, and a lens reading it could only guess.

Reading the forge is a network call and is deliberately opt-in and off the first
paint, so `not-looked-up` is the ordinary answer rather than the exceptional one

- which is exactly why it is worth being able to state plainly, and why it also
  appears in `omissions`.

The panel can now fill both, through `gh`, when the operator sets
`QUARTERDECK_READ_FORGE`. It reads only where upstream published nothing, never
before a render has been served, and never more than once a minute per pull
request. A read that failed comes back `unreadable` with the line it failed
with, never as `not-looked-up`: saying nobody asked would be a lie about what
the panel just did. See `docs/decisions/2026-08-31-reading-the-forge.md`.

### The lifecycle stage model

Three things, not one.

```ts
Lifecycle {
  stage: Stage
  step: ValidationStep | null
  lastActiveStage: ActiveStage | null   // where it was when it stopped
  detail: string                   // upstream's own words, one line
  observedAt: string               // ISO-8601, when this reading was taken
}
```

**The coarse stage** is where the worker is. Six on-track:

```text
dispatched -> working -> validating -> pr-open -> in-review -> landed
```

and four it stops in: `blocked` (waiting on another work item), `held` (waiting
for a person to decide), `waiting` (waiting on something outside the fleet), and
`failed`.

And one that is neither: `unseen`, the panel saying it cannot see this worker at
all - the worktree was torn down, or no source of current state answered. It
asserts no position on the track and no reason for stopping, because neither was
established. It is deliberately its own group in the type rather than a fifth
halted stage, so that a reader folding stages into "running" and "stopped" has
to decide what to do with it instead of silently counting it as one of them.

**The fine step** is which check is running inside the stage, from the
validation pipeline's own vocabulary:

```text
intent, rebase, review, test, document, lint, push, pr, ci
```

`null` means the stage has no finer detail to give - not that it is unknown.
Upstream reconciles every worker in one read, so a worker's fine detail arrives
with its coarse stage or does not exist. See the decision record for why an
earlier "coarse only, not sharpened yet" state was removed.

The step is read out of upstream's prose `detail` - `"validating: test suite
running"` gives `test`, `"validating (running)"` gives `null` - and only while
validating or while stopped, because outside the pipeline "review" means a
person reading a pull request rather than the pipeline's review step. The first
pipeline word in the detail wins. What is frozen here is the field; the reading
of it is `src/domain/project.ts`'s business and may sharpen.

**Where it stopped** is three fields. `stage` says it stopped, `detail` says why
in words an operator can act on, and `lastActiveStage` says which of the six
on-track stages it was in when it did.

`lastActiveStage` is carried and never derived - upstream asserts it or nobody
does. Anything this repository could compute for it would be computable from the
field beside it, which is why the document seam refused a prior-stage field the
first time; what changed is not that the derivation got better but that there is
now a slot a finer upstream can assert into. An active stage only: "where was it
standing" cannot be answered with "it had stopped".

`null` is what every worker on a live fleet reads, because upstream publishes no
such record and has no vocabulary for one. Where it is `null` the rail falls
back to deducing a position from the step, and where that cannot reach either it
says the position is not known rather than inventing one. Checked against two
live homes on 2026-09-01; the commands are in
`docs/decisions/2026-09-01-the-stage-a-stop-happened-in.md`.

### The deck part

```ts
DeckItem {
  id: string
  title: string
  project: string | null           // null when the row did not say
  kind: "build" | "research" | null // null when the row did not say
  state: "queued" | "in-flight"
  priority: "now" | "next" | "later"
  since: string | null             // a day, YYYY-MM-DD, or a full ISO-8601 instant;
                                   // null when no start date was recorded
  blocked: { ids: string[], reason: string | null } | null
  hold: { waitingOn: string, reason: string | null, deferredTo: string | null } | null
  actionable: boolean              // waiting on a person right now
}
```

See `docs/decisions/2026-08-31-what-the-document-may-not-say.md` for why all
three of version 3's fields are nullable and what that cost.

`project` and `kind` are enough identity to recognise a piece of work by, which
is what a queue is read for. Both are nullable where a worker's are not: a
worker is dispatched with a kind and works somewhere, while a backlog row is
written by hand and often annotates neither. A row that said nothing renders
without them rather than under a guessed word.

`since` is nullable for the same reason. A row with no start date carries none,
and the lens says so; dating it from the moment upstream happened to look made
every such row read as having just arrived. It is also part of the answer
record's identity, where the absence travels as the empty string - a stable name
where the read's own moment was not.

`since` also carries **two forms, and which one is a fact about the record**: a
calendar day, `YYYY-MM-DD`, when the operator wrote a day, and a full ISO-8601
instant when the record held one. A backlog line usually says `(since
2026-08-31)` and carries no time at all. The day is not widened to midnight, and
a reader must phrase an age at the precision it finds - see
`docs/decisions/2026-08-31-the-precision-a-date-carries.md`. `hold.deferredTo`
and `LandedItem.landedOn` carry a day in the same slot for the same reason.

Blocked and held are overlays rather than states: an item can be queued and
held, or in flight and blocked. Upstream keeps them orthogonal and so does this.

`actionable` is upstream's own fold - queued or held for a person, unblocked,
and past any deferral date - carried rather than recomputed. Two implementations
of that rule would disagree the day it changes.

Items upstream reports as `done` are not in the deck. The deck is what is still
coming.

### The landed part

```ts
LandedItem {
  id: string
  title: string
  where: "this-home" | "second-mate"
  home: string | null              // the home it landed in; null when unnamed
  project: string | null
  pullRequest: string | null       // the full address, or null for none
  closedAs: string | null          // upstream's word: merged, reported, done
  landedOn: string | null          // YYYY-MM-DD, or null
}
```

Its own lens rather than a corner of the deck. The deck is what is still coming,
by the rule stated above it, and landed work arrives partly from homes the deck
knows nothing about: `done` rows of this home's own backlog, and upstream's
roll-up of what second mates landed in theirs. Work a second mate landed is
still the operator's work, and prior boards lost it by only ever looking at one
home.

`where` is what tells the two apart, and `home` is what a lens says out loud.
`home` is `null` rather than defaulted to the home on screen, because answering
"here" for a record whose provenance upstream did not state would attribute a
second mate's work to the fleet being looked at. A second mate's landed record
carries no `repo` in upstream's roll-up, so its `project` is `null` too.

`landedOn` gets the same rule `Hold.deferredTo` gets: a calendar date or
nothing. Upstream lifts it out of a hand-written record, and a live fleet has
been observed writing a whole sentence into that field. A sentence rendered
where the panel promised a date is a dishonest render, and a hundred characters
in a date-shaped slot is the shape that bursts a lens frame sideways.

The landed lens shares the deck's status: both come from the same snapshot and
both go dark when upstream could not read the backlog. What survives that is a
second mate's landed work, which is rolled up separately - a home this panel
cannot read says nothing about a home it can.

### The omissions

```ts
Omission {
  what: string                     // named the way an operator would name it
  reason: "not-shown" | "not-looked-up" | "unreadable"
  detail: string                   // one line: which bound, which read, which home
}
```

Not a lens: a statement about the page rather than a part of it, and on the
document rather than assembled in a component so that an absence cannot be
introduced by a reader that forgets to declare it. The projection is the one
place that knows both what upstream sent and what it said it could not send.

The three reasons are not interchangeable. `not-shown` is a deliberate bound -
a list cut to a length. `not-looked-up` is work nobody has done yet, which is a
thing that could still be done. `unreadable` is a read that was attempted and
failed. Folding them into one "missing" would let a bound and a failure look
alike, which is the exact ambiguity the disclosure bar exists to remove.

An empty list means nothing was left out, which is itself worth being able to
state. When the snapshot read fails, the list carried over is the last good
one: the read that would have said what is missing is the read that failed, and
inventing a fresh list from a snapshot that does not exist would be the
disclosure bar making a claim about a page it never saw.

### The health part

```ts
Health {
  supervisor: { read: "ok", alive: boolean, lastSeen: string }    | Unreadable
  queue:      { read: "ok", queued: number }                      | Unreadable
  attendance: { read: "ok", away: boolean, locked: boolean }      | Unreadable
  overdue:    { read: "ok", overdue: Overdue[] }                  | Unreadable
  drift:      { read: "ok", disagreements: Disagreement[] }       | Unreadable
}

Unreadable    { read: "unreadable", detail: string }
Overdue       { id: string, waitingSince: string }
Disagreement  { record: string, detail: string }
```

Every signal has an honest "could not be read" value, and they fail
independently: the supervisor can be readable while the drift check is not. An
empty `overdue` or `disagreements` means the check ran and found nothing, which
is a different fact from not being able to run it.

`queue` is a depth, not a verdict: whether a given depth is a problem is the
lens's judgement. `queued: 0` is a queue that was read and found empty, which is
not the same fact as one that could not be read.

`attendance` is one signal carrying two facts rather than two signals, because
they are read from the same directory in the same pass and fail together -
whatever hides one marker hides the other, and two signals could only say so
twice. The shipshape strip draws them as two entries; that is the lens's
business. `locked` is whether a lock is held and nothing finer: whether its
holder is still alive is the fleet's own liveness policy, and reimplementing
that is what the quarantine exists to refuse.

This part is read by the quarantined module, whose contract is that it degrades
rather than throws. That contract extends to a signal the file predates: a
health file carrying no `queue` key reports `queue` as unreadable rather than
refusing the whole file, because a key that was not invented yet is not a shape
that changed, and darkening four working signals over the fifth is the opposite
of degrading. The cost is that a misspelled key reads as an absent one, which is
the right side of that trade for a file with no compatibility promise.

### Version history

| Version | Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | 2026-08-30 | First shape. Workers and their states, and one degradation reason at a time.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2       | 2026-08-30 | Three lenses with a status each. Fleet gains the lifecycle stage model, the brief and worktree pointers, and its pull request; deck and health added.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 3       | 2026-08-31 | Three things the frozen shape deferred, in one bump. `DeckItem` gains `project` and `kind`, both nullable, from the `repo` and `kind` upstream publishes per backlog record. `Stage` gains `unseen`, so upstream's `unknown` stops being reported as `waiting`. `DeckItem.since` becomes nullable, so a row with no start date is not dated from the read - which also makes an answer to such a row keep one stable request id instead of minting a fresh one every read.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4       | 2026-08-31 | Everything the wireframe still needs, in one bump, so that seven features can be built against a frozen shape instead of six migrations. `Worker` gains `delivery` and `dispatch` (branch, runtime, model, effort), and its `brief` gains the instructions' own `summary` and `text` - all recorded at dispatch, never inferred. `ChecksState` becomes `ChecksSignal`, with `review` beside it: `not-looked-up` is now a value distinct from `read: "ok"`, because nobody having asked the forge and the forge having answered are different facts. `Health` gains `queue` and `attendance`. The document gains a `landed` lens, including what second mates landed in their own homes, and an `omissions` list naming every absence and which of three reasons it has. Only `delivery`, `runtime` and the landed work come from a live fleet today; the rest is accepted from a finer upstream and exercised by the fixtures, with the evidence in `docs/quality.md`. |
| 5       | 2026-09-01 | `Lifecycle` gains `lastActiveStage`, the coarse stage a worker was in before it stopped, from a `current_state.last_active_state` the parser now accepts. It is what lets a stop be placed on the two rails that have no validating stage for the older step deduction to land on. Accepted and optional, like the finer states already were: a live fleet publishes nothing for it - established against two homes rather than assumed, see the decision record - and the fixtures exercise the anchored path on all four rail shapes.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 6       | 2026-09-01 | A lens that could not be read says which of two ways it came back empty-handed. `LensStatus`'s `unreadable` gains `reason`: `failed` is the fleet answering badly - a command that is not there, a refusal, bytes that will not parse - and `timed-out` is the fleet not answering inside the read budget, which is a fact about its size rather than its health. The badge reads `Timed out` rather than `Could not be read` for the second, and the detail names the cost curve and the setting that raises the budget. A reader must notice because merging them tells an operator their fleet is broken when it is only busy. See `docs/decisions/2026-09-01-the-fleet-read-budget-and-what-a-timeout-means.md`.                                                                                                                                                                                                                                                   |

Bump `DOCUMENT_VERSION` when a reader must notice the change, and add a row.

## The upstream snapshot

`src/adapters/contract.ts`. Owned by the fleet supervisor, not by us.

Read by running the command the fleet home publishes it with -
`<fleet-home>/bin/fm-fleet-snapshot.sh --json`, with `FM_HOME` set to that home.
Upstream's own contract for it is that it is read-only: no lock, no drain, no
arming, no writes. That is the whole reason a panel that calls itself a reader
is allowed to run it.

```ts
{
  schema: "fm-fleet-snapshot.v1"
  generated: string                // ISO-8601; freshness is measured from it
  fm_home: string | null           // the home this snapshot describes
  tasks: [{
    id, project, kind
    harness, mode                  // the runtime, and the delivery contract
    branch, model, effort          // recorded at dispatch; not published today
    brief: { summary, text } | null // the instructions; not published today
    paths: { meta: {path, present}, worktree: {path, present} }
    current_state: { state, detail, observed_at }
    pr: {
      url: string | null
      checks: { read: "ok", outcome, finished, total, as_of }
             | { read: "unreadable", detail } | null    // null: nobody asked
      review: { read: "ok", comments, as_of }
             | { read: "unreadable", detail } | null
    }
    backlog: { completion: { verb } } | null   // the worker's own row, joined on
  }]
  backlog: {
    present: boolean
    records: [{
      structured: true, id, title, repo, kind,
      state: "queued" | "in_flight" | "done",
      priority, since, blocked_by_ids[], blocked_reason,
      hold_kind, hold_reason, hold_until, captain_actionable,
      pr_url, completion: { verb, date } | null    // read for the landed lens
    }]
  }
  secondmate_landed: {             // what mates landed in their own homes
    records: [{ id, title, home, pr_url, completion }]
    truncated: string[]            // homes upstream bounded  -> not-shown
    unreadable: string[]           // homes that did not answer -> unreadable
    partial: string[]              // homes it does not fully trust -> unreadable
  }
}
```

### Strict about structure, tolerant about prose

Upstream's shape has two halves and the parser treats them differently.

What upstream **computes** is a contract, and a value the parser does not
recognise is refused: the schema identifier, `generated`, a task's reconciled
`current_state`, its `paths`, a record's `state`, `captain_actionable`,
whether the backlog could be read at all, and - when they are present at all -
a pull request's `checks` and `review` blocks and the four lists of
`secondmate_landed`. `completion.verb` on the row upstream
joins onto a task is computed too, and is the one structural fact separating a
merged pull request from a green one.

What upstream **copies out of a hand-written backlog** is free text, lifted from
markdown with a regular expression: a record's `priority`, `since`, `title`,
`repo`, `kind`, `hold_kind`, `hold_reason`, `hold_until`, `blocked_reason`,
`pr_url` and `completion`, and a task's `project`, `kind`, `harness`, `mode`,
`branch`, `model`, `effort` and `brief`. `null` is the common answer for `repo`,
`kind`
and `since`, not the odd one - a captain writing a queue line annotates what is
worth annotating and leaves the rest. Those arrive as the strings they are, and `src/domain/`
maps them onto the document's own vocabulary. Darkening the whole deck because
somebody typed `(priority: urgent)` in a list item would be the worse panel.

### Upstream's state vocabulary

A live fleet reconciles every worker to one of seven states. The document draws
more positions than that, so several map onto one:

| Upstream  | Document stage        | Note                                                                                                                                                                                                                                                    |
| --------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `working` | `working`             |                                                                                                                                                                                                                                                         |
| `parked`  | `held`                | Waiting for a person to decide                                                                                                                                                                                                                          |
| `blocked` | `blocked`             | Waiting on another work item                                                                                                                                                                                                                            |
| `done`    | `landed` or `pr-open` | The run finished. Upstream says `done` for a merged pull request and for one whose checks merely went green, so the worker's own backlog row decides: `completion.verb` of `merged` lands it, anything else with a pull request leaves it at `pr-open`. |
| `failed`  | `failed`              |                                                                                                                                                                                                                                                         |
| `paused`  | `waiting`             | Deliberately idling on a wait it expects to clear                                                                                                                                                                                                       |
| `unknown` | `unseen`              | Upstream could not tell - a torn-down worktree, no source of current state answering. The document says the panel cannot see the worker rather than placing it                                                                                          |

`dispatched`, `validating`, `pr_open`, `in_review`, `waiting_external` and
`landed` are also accepted and mapped. A reconciled live snapshot has not been
observed to emit them; they are what the fixture fleets use to exercise the
document's whole lifecycle rail, and what a finer upstream would emit without
this parser needing to change.

Those seven are the whole vocabulary, and upstream declares it in its own header
at `bin/fm-crew-state.sh:18` rather than leaving it to be inferred:

```text
state: <working|parked|done|blocked|paused|failed|unknown>
```

`current_state.last_active_state` takes the same six on-track spellings and is
the one field where the closed set is narrower than `state`'s: it is where a
worker was standing, and a halted value is not a place to stand. It is accepted,
optional, and no live fleet has been observed to publish it - see below.

### Blocks a live fleet does not publish

`branch`, `model`, `effort`, `brief`, `current_state.last_active_state`, a pull
request's `checks` and `review`, `fm_home` and `secondmate_landed` are all
accepted and all optional. A block
that is absent is not a snapshot to refuse: it is a fleet that has nothing to
say about it, and the projection produces the corresponding honest absence -
`null` for a dispatch field, `not-looked-up` for a forge reading, an empty
roll-up for the mates.

This is the arrangement the finer lifecycle states already have. The fixture
fleets fill these blocks so the document's whole shape has something to exercise
it, a live fleet leaves most of them out, and a finer upstream fills them
without this parser changing. `docs/quality.md` records which is which, and the
evidence for each.

Present, though, a block is structural and refused like any other computed
field: a `checks` block saying `passing` with no counts is a block whose meaning
we would be guessing at.

### Watching a fleet home

Two directories under the home, and both: `state`, where a worker's records
move, and `data`, where the backlog the deck is drawn from lives. They move
independently - a worker changing state touches the first, a captain queuing an
item touches the second - so watching only one leaves the other lens showing
what it had until something unrelated happens to change. `fleetWatchDirs` in
`src/adapters/contract.ts` is the only place that knows either name.

### Records that are not work items

Upstream preserves every non-empty line of the backlog's sections, marking the
ones it could read as a work item `structured: true` and keeping the rest
verbatim. An unstructured line has no id, no title and no state, so it is not a
deck item and the parser drops it. That a backlog contains one is a health
finding rather than something for the deck lens to draw.

`backlog.present: false` is upstream saying it could not read the backlog at
all. That darkens the deck lens and leaves the fleet alone.

Upstream carries more than this parses - each task's endpoint and status log,
the scout reports, the main inventory, the secondmate rows. Fields no lens reads
are not parsed: a value nobody renders is one the next reader has to guess the
meaning of. Add the field here when a lens needs it.

## The health file

`src/adapters/health.ts`. Not upstream's shape - nothing upstream publishes
these signals - so there is no contract to pin and nothing to guess.

```ts
{
  asOf: string
  supervisor: { read: "ok", alive, lastSeen } | { read: "unreadable", detail }
  queue:      { read: "ok", queued }          | { read: "unreadable", detail }
  attendance: { read: "ok", away, locked }    | { read: "unreadable", detail }
  overdue:    { read: "ok", overdue: [...] }  | { read: "unreadable", detail }
  drift:      { read: "ok", disagreements: [...] } | { read: "unreadable", detail }
}
```

Read from a directory the quarantined module is the only file allowed to name.
Every failure - a missing file, a moved directory, a shape that changed under us

- comes back as an unreadable reading. Nothing escapes that function: a
  quarantined module that can take the panel down is not quarantined.

## The fleet home

The same three signals, read from a running fleet's own files when
`QUARTERDECK_FLEET_HOME` names a home. That is the source with no compatibility
promise at all, which is why it lives in the quarantined module beside the
fixture reader and why every read below has a stated "could not be read" answer
rather than an assumption.

| Signal       | Where it comes from                                                                                                                                                                                        | What makes it unreadable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supervisor` | The liveness beacon in the state directory, touched on every supervision poll. It holds nothing; its modification time is the entire signal, and `alive` is that age against the fleet's own grace window. | No beacon. A file that has moved and a cycle that has stopped look identical from outside, and reporting the wrong one is worse than saying so.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `overdue`    | One entry per worker the fleet has out - a `.meta` file - whose one-line busy record says idle, for longer than the fleet's own wedge threshold, with no declared wait on the last line of its status log. | The state directory cannot be listed. A single worker's record that is missing, malformed or carrying a retired incarnation token is _unknown_, never idle: that is upstream's own rule, and inventing "idle" from a record we could not read would report a working fleet as stalled.                                                                                                                                                                                                                                                                                                |
| `queue`      | The delivery queue in the state directory, one queued notification per line. Its depth is the whole signal.                                                                                                | The state directory cannot be listed. A file that exists and will not be read is unreadable too, but an absent file only reads as an empty queue once the directory it would live in is confirmed listable - ENOENT on the file alone cannot tell "not there yet" from "the directory is gone", and the fleet creates the file when it first has something to deliver, so only the first of those is "nothing queued".                                                                                                                                                                |
| `attendance` | Two markers in the state directory, read in one listing: the away marker, and the per-home session lock. Each holds nothing; its presence is the entire signal.                                            | The state directory cannot be listed. Both facts come from the one listing on purpose - a `stat` that says ENOENT cannot tell "the marker is not there" from "the directory is not there", and answering "away mode is off" for a home the panel cannot see would be inventing a fact about it. `locked` is whether a lock is held and nothing finer: whether its holder is still alive is the fleet's own liveness policy, read from a process table with the fleet's own rules about what counts as a harness, and reimplementing that here is exactly what the quarantine refuses. |
| `drift`      | The work item record and the state directory, compared. A row in flight with no worker behind it; a row still held while its own status log records the decision answered.                                 | Either record cannot be read. Whether a record disagrees with reality is a question about both halves, so one missing takes the signal rather than producing an answer from the half that is left.                                                                                                                                                                                                                                                                                                                                                                                    |

Two things are deliberately not configuration. The paths, because they are the
unstable dependency the quarantine exists to confine. And the two thresholds -
the beacon's grace window and the point an idle worker becomes a possible wedge

- because they are the fleet's own policy: a number that drifts out of step with
  upstream makes the lens wrong, not adjustable.

A declared wait is not a problem. `paused:` and `captain-held:` are the fleet's
two ways of saying an idle worker is idle on purpose, and reporting either as a
stall would teach an operator to ignore the signal. `blocked:` and
`needs-decision:` are not declared waits: a worker stopped for those is waiting
on the machinery this lens watches.

## The no-mistakes run (the terminal panel's second boundary)

`quarterdeck-tui` reads one thing the web panel does not: which no-mistakes
pipeline run belongs to a work item. Its surface is `no-mistakes axi status`,
no-mistakes' own agent interface, and the shape it prints is TOON. The schema
is not copied here - `no-mistakes axi status --help` and the output itself are
authoritative, and this reader is written to skip a table or a column it does
not recognise rather than to require one.

Two facts about the join are this project's rather than upstream's, and they
are the ones worth writing down:

- The join is the branch, `fm/<task-id>`, matched exactly. Firstmate publishes
  no run identifier on a task - a live `bin/fm-fleet-snapshot.sh --json` carries
  no such field on any task - so the branch a worker was dispatched onto is the
  only thing the two sides agree about. Prefix matching would make
  `demo-alpha-a1` and `demo-alpha-a10` the same item.
- The listing is bounded and the count beside it is not, so a run can exist and
  not be listed. When `runs_on_current_branch` disagrees with the rows, the
  count is believed and the operator is told the run is out of reach rather
  than absent.

The one command the terminal panel runs on an operator's word is `no-mistakes
attach --run <id>`, as an argument vector in the work item's worktree, never
through a shell. Nothing else about no-mistakes is touched: its database is
never read, and its daemon - one instance serving every repository on the
machine - is never started, stopped or restarted.

## The terminal tail (the one shape read on demand)

`src/types/terminal.ts`. The panel's own shape, and the only one that is not
part of the document - deliberately, because everything on the document is read
on every pass for every worker, and this is read only when an operator expands a
card.

```ts
{
  worker: string                   // the work item, as the fleet published it
  asOf: string                     // ISO-8601, when this read was taken
  reading:
    | { read: "ok", lines: string[] }        // never empty; see "silent"
    | { read: "silent" }                     // asked, and it had nothing to say
    | { read: "no-session", detail: string } // nowhere to look
    | { read: "unreadable", detail: string } // looked, and the read failed
}
```

The last three are three different facts about a worker and are never merged.
`ok` cannot carry an empty list: a capture is normalised - trailing blank rows
dropped - before the arm is chosen, so a pane that is all blanks is `silent`.

Two sources, one normaliser:

| Source        | Where the bytes come from                                                                                                                                                                    | What makes it unreadable                                                                                                                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A fleet home  | `bin/fm-peek.sh <worker> 15`, run through the one spawn door with `FM_HOME` set. Read-only by upstream's own contract: it resolves the worker's recorded session target and prints the tail. | The command failed. Its standard error is the detail, verbatim. A failure whose words name a missing session - "no metadata for", "no backend target recorded", "no window named" - is `no-session`; anything else is `unreadable`, which is honest rather than guessed. |
| A fixture set | `terminal.json` beside the set's other files, one entry per work item id, in the shape above. `ok` entries carry raw captured text so a fixture normalises exactly as a fleet does.          | The file exists and will not parse. An absent file, and an id the file does not name, are both `no-session`: a synthetic fleet that records no sessions is not a fleet whose machinery is broken.                                                                        |

The read is bounded before it starts. The worker has to be one the current
document lists and has to match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`, because
upstream's peek resolves any selector containing a colon as a raw session
target. Neither check is optional and neither happens after the spawn. See
`docs/decisions/2026-08-31-the-worker-terminal.md`.

## The intent records (the two things the panel writes)

The panel's only outbound shapes, written by `src/adapters/intent.ts` and by
nothing else.

`Intent` is a union discriminated on `kind`, with two members -
`answer-decision` and `merge-pull-request` - and a table beside it giving each
kind its file extension and the bytes it holds. A kind is a member added to the
union and a row added to the table; it is not a second writer, and it may not
redefine the others. That matters more than it sounds: the whole safety argument
for this panel is that exactly one file writes, and a second intent kind
arriving as a second file would end that argument quietly.

The extension is part of each format rather than a constant beside it, because
it is what lets a reader route a record to the right intake - a merge order
landing with `.keyed-answer-v1` on it would be handed to the answer intake,
which would find a line it cannot parse.

Both formats are frozen. Records written by earlier builds are still sitting in
spools, and their names are what make a replay a collision rather than a second
action; `tests/answering.test.ts` and `tests/merging.test.ts` pin each digest and
extension for that reason. Where they go is declared per fleet, not once for
the panel:
`QUARTERDECK_INTENT_DIR` is a colon-separated list positionally aligned with the
configured fleet list, the same convention `QUARTERDECK_FLEET_HOME` and
`QUARTERDECK_FIXTURE_SET` use. A request is written to the selected fleet's own
directory, resolved from the selection cookie the same way the page resolves
which fleet to render - never from a field the client sends. A fleet whose slot
is empty or absent has no spool, and its write path is closed rather than
guessed at.

### `answer-decision`

One file per answered decision, named `<request-id>.keyed-answer-v1`, holding one
line and nothing else:

```text
<task-id>\t<answer>\t<label>\t<mode>\n
```

That is the line `bin/fm-captain-hold.sh answers` reads on stdin, unchanged. The
key is the task id verbatim; `<mode>` is `done` or `release` and is whichever
close the card declared and the operator pressed. Nothing else may appear in the
file - a header or a second line would reach the intake as a bogus key.

The request id is `sha256(task id, since, answer, label, mode)`, truncated,
which makes the same question-and-answer name the same record every time. The
record is published with `link`, so a replay collides with the existing name and
writes nothing.

The panel does not feed the intake and does not run anything. Feeding it is a
reader's job: one that picks these records up, re-verifies the decision is still
open, and pipes the lines in. Upstream firstmate ships no such reader, so the
line above is written and read by nothing until an operator builds one - which
is what this format is here to be built against. See
`docs/decisions/2026-08-30-answering-a-held-decision.md`.

### `merge-pull-request`

One file per merge order, named `<request-id>.merge-order-v1`, holding one line
and nothing else:

```text
<task-id>\t<pr-url>\n
```

Those are exactly the two arguments `bin/fm-pr-merge.sh` takes, in its order.
The address is the full URL, always - the command resolves the owner and
repository out of it, and a bare number would have to be resolved against a
repository somebody guessed at. Nothing about the checks, the review or the
branch is in the record: the command reads all of that live at merge time and
owns every rule about whether the merge may happen.

The request id is `sha256(task id, pr url)`, truncated. Nothing that moves is in
it - not the checks' `as_of`, which changes every time the forge is read, and
not a head commit, which this document does not carry - so the same order always
names the same record and a double click is a collision. Published with `link`,
like the answer.

Unlike an answer, the route re-reads the fleet before recording one, and refuses
an order whose pull request has gone red, closed, landed, moved or vanished
since the page was drawn. That is the panel declining to carry an order whose
premise has expired, not the panel deciding a merge is allowed. See
`docs/decisions/2026-08-31-ordering-a-merge.md`.

## The pinned identifier

`SNAPSHOT_SCHEMA_ID` is `"fm-fleet-snapshot.v1"`, compared on every parse before
any other field is read.

A mismatch throws `ContractIdentifierError` naming the expected and the found
identifier, and the panel renders a refusal and nothing else. It never falls
back to an older document, because a changed contract means every field is
suspect: rendering a plausible-looking fleet from fields whose meaning has
shifted is the exact failure the pin exists to prevent.

This is distinct from `ContractParseError`, which a malformed snapshot throws.
The recovery differs on purpose: a half-written file will be whole a moment
later, so the runtime keeps showing last-known-good and marks the fleet, deck
and landed lenses unreadable. A changed schema will still be changed on the
next read.

Neither affects health, which is read separately and reports for itself.

### Changing the pin

1. Update `SNAPSHOT_SCHEMA_ID` and the parser in `src/adapters/contract.ts`.
2. Update the projection in `src/domain/project.ts` if the vocabulary moved.
3. Add a fixture set for the new shape, and keep the old `mismatched` fixture -
   the refusal path must stay tested.
4. Add a row here.

| Identifier             | Date       | Note                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fm-fleet-snapshot.v1` | 2026-08-30 | First pinned identifier. The shape above replaced a provisional reading of the same identifier once upstream was verified against a live fleet; the identifier itself never moved.                                                                                                                                       |
| `fm-fleet-snapshot.v1` | 2026-08-30 | Corrected against a live fleet's own output when the real source was wired: `generated` rather than `generated_at`, a coarser state vocabulary, `pr` always an object, and free text where a closed set was assumed. The identifier did not move, so this is a correction to our reading rather than an upstream change. |

## Open assumptions

Written down because the worker who wires a real fleet source is the one who
will find out, and should find a list rather than a surprise. Each is pinned by
`src/adapters/contract.ts` and the fixtures, which is one file and one directory
to correct.

### Settled against a live fleet

Every assumption this section carried when the document seam was frozen has now
been checked against a live fleet. Only one held; the corrections for the rest
are above:

| Assumption                                                    | What a live fleet does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | What changed                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A snapshot carries top-level `generated_at`                   | It carries `generated`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | The parser and the fixtures. The document type did not change.                                                                                                                                                                                                       |
| `current_state.state` is a six-stage on-track vocabulary      | Seven reconciled states, coarser than the document's                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | The `STAGE` map gained `done`, `paused` and `unknown`; the finer values are still accepted.                                                                                                                                                                          |
| `priority` is `now`, `next` or `later`                        | Free text; a live fleet writes `1`, `2`, `3`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | The projection maps both spellings and defaults to `later`.                                                                                                                                                                                                          |
| A pull request's checks are not carried                       | Confirmed again on 2026-08-31: `pr` carries `url` and `source` (`meta`, `status_event` or `absent`) and nothing else. No review comments either.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `ChecksState` became `ChecksSignal`, and `review` joined it. Both read `not-looked-up` for every worker a live fleet reports - which is a statement about what nobody has done, not a failure, and it is named in `omissions`. Document version 4.                   |
| A worker's branch, model and effort are not recorded anywhere | Wrong twice over, and the correction matters. All three ARE recorded at dispatch, in the home's own `state/<id>.meta`: `model=`, `effort=` and the worktree. What is true is narrower - the snapshot command publishes none of them. `grep -nE 'model\|effort\|branch' bin/fm-fleet-snapshot.sh` matches nothing, and no such key appears in a live `--json`. A branch is not recorded at all, in the meta record or the snapshot.                                                                                                                                                                                                                            | `dispatch` carries all four nullable and the parser accepts them optionally, so a finer upstream fills them without a parser change. `runtime` is filled today from `harness`; the other three are `null` on every live read. See `docs/quality.md`.                 |
| The brief path upstream publishes points at the instructions  | Wrong. `paths.meta` points at `state/<id>.meta`, the key-value dispatch record - not at the brief, which `bin/fm-brief.sh` scaffolds at `data/<id>/brief.md`. The snapshot publishes no brief path and no brief text: `grep -n brief bin/fm-fleet-snapshot.sh` matches nothing.                                                                                                                                                                                                                                                                                                                                                                               | `Brief` gained `summary` and `text`, both `null` on every live read. The `ref` mapping is unchanged, and `Brief`'s docblock now warns that the pointer is not necessarily the brief file rather than promising it is.                                                |
| A worker's kind is the whole of what decides its rail         | Wrong. `mode` is published per task and is the delivery contract: a live fleet writes `no-mistakes`, `direct-PR` and `local-only` for ship work and `secondmate` for a mate, which `bin/fm-brief.sh` and `bin/fm-promote.sh` both name as the closed set.                                                                                                                                                                                                                                                                                                                                                                                                     | `Worker.delivery` carries it, mapped to `validated`, `direct-pr` and `local`, and `null` for anything else. `upstream-shape` was corrected to the real vocabulary. Document version 4.                                                                               |
| Landed work is not published                                  | Wrong, and this was the wireframe's own worry: prior boards lost it. This home's landed work is the backlog's `done` rows, which carry `pr_url`, `repo` and `completion: { verb, date }`; second mates' is `secondmate_landed`, whose records are stamped with the home each came from and which declares what it truncated, could not read, or does not fully trust. A live read of one home produced ten landed items with real addresses.                                                                                                                                                                                                                  | A `landed` lens, and an `omissions` list built partly from those three declarations. Document version 4.                                                                                                                                                             |
| A completion date is a date                                   | Wrong. It is lifted out of a hand-written record, and a live fleet was found carrying one that is a whole sentence - naming a commit, a pull request URL and what is still needed from the operator - where a date belongs.                                                                                                                                                                                                                                                                                                                                                                                                                                   | `landedOn` takes the rule `deferredTo` already had: a calendar date or nothing. `upstream-shape` carries the sentence form.                                                                                                                                          |
| The stage a worker was in before it stopped is not published  | Right, and now established rather than assumed. Checked on 2026-09-01 against `bin/fm-fleet-snapshot.sh --json` in two live homes: every task's `current_state` carries exactly six keys - `detail`, `freshness`, `observed_at`, `raw`, `source`, `state` - and none of them is a prior stage. It is not merely unpublished but unrecorded: `grep -rn 'pr_open\|in_review\|last_active\|prior_state\|previous_state' bin/` matches nothing in either home, so upstream has no vocabulary for a rail stage to keep a history of. `paths.status_log.last_event.state` is the crewmate's own report verb, a different vocabulary answering a different question. | `Lifecycle` gained `lastActiveStage` and the parser accepts `current_state.last_active_state`, so a finer upstream fills it without a parser change. `null` on every live read. Document version 5, and `docs/decisions/2026-09-01-the-stage-a-stop-happened-in.md`. |
| A backlog record carries no project and no kind               | It carries both, per record: `repo` is the project and `kind` is `ship` or `scout` - the same build-versus-research distinction a task's kind makes. A live fleet also writes `task` and `docs`, and leaves both fields out entirely more often than not                                                                                                                                                                                                                                                                                                                                                                                                      | The parser reads both, `DeckItem` carries them nullable, and the deck lens draws them. Document version 3.                                                                                                                                                           |

### Still open

Version 3 settled two of the three rows this section carried, and version 4
settled the rest by reading a live fleet again rather than reasoning about it.
Two of those readings had been written down backwards - upstream was said not to
have something it plainly did - which is why every row above now cites the
command or the file it was checked against rather than describing the result.

One assumption remains.

| Assumption                      | Why it is a guess                                                                                                                                                                                | What happens if it is wrong                                                                                                                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `kind` is `scout` or building | `kind` is free text, copied from a worker's dispatch record or a row's `(kind: ...)` annotation. A live fleet writes `ship`, `scout`, `task`, `docs` and `secondmate`, and often nothing at all. | Anything that is not `scout` renders as building. A deck row that named no kind says so; a worker with none still reads as building, because a worker is always doing something. A kind that deserves its own treatment gets one in `WorkerKind`, which is a document version bump. |
