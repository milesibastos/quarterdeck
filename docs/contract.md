# Contracts

Three shapes and the boundaries between them. Upstream owns the fleet snapshot,
the panel owns the document, and the health file sits in between - the panel's
own shape, read from a location upstream can move without telling anyone.

`src/domain/` is the only thing that knows more than one of them.

## The document (the panel's own)

`src/types/document.ts`. The single shape `src/ui/` reads. Nothing in the UI may
reach past it, which is what makes the panel replaceable - and it is the seam
several workers build against at once, some filling it and some drawing it.

```ts
{
  version: number
  generatedAt: string              // ISO-8601, when this document was assembled
  fleet:  { content: Worker[],   status: LensStatus }
  deck:   { content: DeckItem[], status: LensStatus }
  health: { content: Health,     status: LensStatus }
}
```

### The envelope: a status per lens

```ts
type LensStatus =
  | { state: "fresh",      asOf: string }
  | { state: "stale",      asOf: string, ageMs: number, detail: string }
  | { state: "unreadable", observedAt: string, detail: string }
```

There is deliberately no document-wide `degraded` flag. Fleet and deck come from
one upstream contract that either parses or refuses; health comes from files
that may simply have moved. Two reliability promises meet in one document, so
each lens says for itself whether it is good, stale and by how much, or dark.

`content` is always present. A stale lens still carries what it last had, and an
unreadable one carries the last thing that read cleanly - which may be nothing.
The panel never renders a blank area or an error page in place of a lens.

### The fleet part

```ts
Worker {
  id: string                       // the work item; stable, and the UI's key
  project: string
  kind: "build" | "research"
  brief:    { ref: string, present: boolean }   // the dispatch instructions
  worktree: { ref: string, present: boolean }   // the isolated copy it works in
  lifecycle: Lifecycle
  pullRequest: { url, state: "open" | "landed", checks: ChecksState } | null
}
```

### The lifecycle stage model

Three things, not one.

```ts
Lifecycle {
  stage: Stage
  step: ValidationStep | null
  detail: string                   // upstream's own words, one line
  observedAt: string               // ISO-8601, when this reading was taken
}
```

**The coarse stage** is where the worker is. Six on-track:

    dispatched -> working -> validating -> pr-open -> in-review -> landed

and four it stops in: `blocked` (waiting on another work item), `held` (waiting
for a person to decide), `waiting` (waiting on something outside the fleet), and
`failed`.

**The fine step** is which check is running inside the stage, from the
validation pipeline's own vocabulary:

    intent, rebase, review, test, document, lint, push, pr, ci

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

**Where it stopped** is `stage` plus `detail`: the stage says it stopped, the
detail says why, in words an operator can act on. There is no separate
"prior stage" field - see the decision record.

### The deck part

```ts
DeckItem {
  id: string
  title: string
  state: "queued" | "in-flight"
  priority: "now" | "next" | "later"
  since: string                    // ISO-8601; a hold's age is measured from here
  blocked: { ids: string[], reason: string | null } | null
  hold: { waitingOn: string, reason: string | null, deferredTo: string | null } | null
  actionable: boolean              // waiting on a person right now
}
```

Blocked and held are overlays rather than states: an item can be queued and
held, or in flight and blocked. Upstream keeps them orthogonal and so does this.

`actionable` is upstream's own fold - queued or held for a person, unblocked,
and past any deferral date - carried rather than recomputed. Two implementations
of that rule would disagree the day it changes.

Items upstream reports as `done` are not in the deck. The deck is what is still
coming.

### The health part

```ts
Health {
  supervisor: { read: "ok", alive: boolean, lastSeen: string }    | Unreadable
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

This part is read by the quarantined module, whose contract is that it degrades
rather than throws.

### Version history

| Version | Date | Change |
| --- | --- | --- |
| 1 | 2026-08-30 | First shape. Workers and their states, and one degradation reason at a time. |
| 2 | 2026-08-30 | Three lenses with a status each. Fleet gains the lifecycle stage model, the brief and worktree pointers, and its pull request; deck and health added. |

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
  tasks: [{
    id, project, kind
    paths: { meta: {path, present}, worktree: {path, present} }
    current_state: { state, detail, observed_at }
    pr: { url: string | null }
    backlog: { completion: { verb } } | null   // the worker's own row, joined on
  }]
  backlog: {
    present: boolean
    records: [{
      structured: true, id, title, state: "queued" | "in_flight" | "done",
      priority, since, blocked_by_ids[], blocked_reason,
      hold_kind, hold_reason, hold_until, captain_actionable
    }]
  }
}
```

### Strict about structure, tolerant about prose

Upstream's shape has two halves and the parser treats them differently.

What upstream **computes** is a contract, and a value the parser does not
recognise is refused: the schema identifier, `generated`, a task's reconciled
`current_state`, its `paths`, a record's `state`, `captain_actionable`, and
whether the backlog could be read at all. `completion.verb` on the row upstream
joins onto a task is computed too, and is the one structural fact separating a
merged pull request from a green one.

What upstream **copies out of a hand-written backlog** is free text, lifted from
markdown with a regular expression: a record's `priority`, `since`, `title`,
`hold_kind`, `hold_reason`, `hold_until`, `blocked_reason`, and a task's
`project` and `kind`. Those arrive as the strings they are, and `src/domain/`
maps them onto the document's own vocabulary. Darkening the whole deck because
somebody typed `(priority: urgent)` in a list item would be the worse panel.

### Upstream's state vocabulary

A live fleet reconciles every worker to one of seven states. The document draws
more positions than that, so several map onto one:

| Upstream | Document stage | Note |
| --- | --- | --- |
| `working` | `working` | |
| `parked` | `held` | Waiting for a person to decide |
| `blocked` | `blocked` | Waiting on another work item |
| `done` | `landed` or `pr-open` | The run finished. Upstream says `done` for a merged pull request and for one whose checks merely went green, so the worker's own backlog row decides: `completion.verb` of `merged` lands it, anything else with a pull request leaves it at `pr-open`. |
| `failed` | `failed` | |
| `paused` | `waiting` | Deliberately idling on a wait it expects to clear |
| `unknown` | `waiting` | Upstream could not tell; see open assumptions |

`dispatched`, `validating`, `pr_open`, `in_review`, `waiting_external` and
`landed` are also accepted and mapped. A reconciled live snapshot has not been
observed to emit them; they are what the fixture fleets use to exercise the
document's whole lifecycle rail, and what a finer upstream would emit without
this parser needing to change.

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
`QUARTERDECK_FLEET_HOME` names one. That is the source with no compatibility
promise at all, which is why it lives in the quarantined module beside the
fixture reader and why every read below has a stated "could not be read" answer
rather than an assumption.

| Signal | Where it comes from | What makes it unreadable |
| --- | --- | --- |
| `supervisor` | The liveness beacon in the state directory, touched on every supervision poll. It holds nothing; its modification time is the entire signal, and `alive` is that age against the fleet's own grace window. | No beacon. A file that has moved and a cycle that has stopped look identical from outside, and reporting the wrong one is worse than saying so. |
| `overdue` | One entry per worker the fleet has out - a `.meta` file - whose one-line busy record says idle, for longer than the fleet's own wedge threshold, with no declared wait on the last line of its status log. | The state directory cannot be listed. A single worker's record that is missing, malformed or carrying a retired incarnation token is *unknown*, never idle: that is upstream's own rule, and inventing "idle" from a record we could not read would report a working fleet as stalled. |
| `drift` | The work item record and the state directory, compared. A row in flight with no worker behind it; a row still held while its own status log records the decision answered. | Either record cannot be read. Whether a record disagrees with reality is a question about both halves, so one missing takes the signal rather than producing an answer from the half that is left. |

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
later, so the runtime keeps showing last-known-good and marks the fleet and deck
lenses unreadable. A changed schema will still be changed on the next read.

Neither affects health, which is read separately and reports for itself.

### Changing the pin

1. Update `SNAPSHOT_SCHEMA_ID` and the parser in `src/adapters/contract.ts`.
2. Update the projection in `src/domain/project.ts` if the vocabulary moved.
3. Add a fixture set for the new shape, and keep the old `mismatched` fixture -
   the refusal path must stay tested.
4. Add a row here.

| Identifier | Date | Note |
| --- | --- | --- |
| `fm-fleet-snapshot.v1` | 2026-08-30 | First pinned identifier. The shape above replaced a provisional reading of the same identifier once upstream was verified against a live fleet; the identifier itself never moved. |
| `fm-fleet-snapshot.v1` | 2026-08-30 | Corrected against a live fleet's own output when the real source was wired: `generated` rather than `generated_at`, a coarser state vocabulary, `pr` always an object, and free text where a closed set was assumed. The identifier did not move, so this is a correction to our reading rather than an upstream change. |

## Open assumptions

Written down because the worker who wires a real fleet source is the one who
will find out, and should find a list rather than a surprise. Each is pinned by
`src/adapters/contract.ts` and the fixtures, which is one file and one directory
to correct.

### Settled against a live fleet

The four assumptions this section carried when the document seam was frozen have
now been checked. Three were wrong, and the corrections are above:

| Assumption | What a live fleet does | What changed |
| --- | --- | --- |
| A snapshot carries top-level `generated_at` | It carries `generated` | The parser and the fixtures. The document type did not change. |
| `current_state.state` is a six-stage on-track vocabulary | Seven reconciled states, coarser than the document's | The `STAGE` map gained `done`, `paused` and `unknown`; the finer values are still accepted. |
| `priority` is `now`, `next` or `later` | Free text; a live fleet writes `1`, `2`, `3` | The projection maps both spellings and defaults to `later`. |
| A pull request's checks are not carried | Confirmed: `pr` carries an address and its source, nothing about checks | Nothing. `ChecksState` is `"unknown"` for every worker, as designed. |

### Still open

| Assumption | Why it is a guess | What happens if it is wrong |
| --- | --- | --- |
| `unknown` belongs on the `waiting` stage | Upstream's `unknown` means it could not tell - a torn-down worktree, no source of current state answering. The document has no stage for "the panel cannot see this worker", so it lands on the one halted stage that asserts no cause inside the fleet, with upstream's own words in `detail`. | It is the least wrong position in a frozen vocabulary, not a good one. The honest fix is a stage of its own, which is a document version bump and a change under every lens - worth doing the next time the seam is unfrozen, not under three workers drawing it. |
| A record with no `since` started when upstream looked | Upstream reports `since` as the operator wrote it, and a row often does not say. The document's `since` is not nullable and a hold's age is measured from it. | The item shows an age of zero rather than dropping off the deck. If ages need to distinguish "just started" from "nobody said", `since` becomes nullable, which is a document version bump. |
| A worker's `kind` is `scout` or building | `kind` is free text copied from a dispatch record and defaults to `ship`; `secondmate` also occurs | Anything that is not `scout` renders as building. A kind that deserves its own treatment gets one in `WorkerKind`, which is a document version bump. |
