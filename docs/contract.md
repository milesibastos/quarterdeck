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

```ts
{
  schema: "fm-fleet-snapshot.v1"
  generated_at: string
  tasks: [{
    id, project, kind: "ship" | "scout"
    paths: { meta: {path, present}, worktree: {path, present} }
    current_state: { state, detail, observed_at }
    pr: { url } | null
  }]
  backlog: {
    present: boolean
    records: [{
      id, title, state: "queued" | "in_flight" | "done", priority, since,
      blocked_by_ids[], blocked_reason, hold_kind, hold_reason, hold_until,
      captain_actionable
    }]
  }
}
```

Upstream's state vocabulary is its own: `dispatched`, `working`, `validating`,
`pr_open`, `in_review`, `landed`, `blocked`, `parked`, `waiting_external`,
`failed`. The projection maps it onto the document's, which is why upstream can
rename `parked` without a component changing.

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

## Open assumptions

Written down because the worker who wires a real fleet source is the one who
will find out, and should find a list rather than a surprise. Each is pinned by
`src/adapters/contract.ts` and the fixtures, which is one file and one directory
to correct.

| Assumption | Why it is a guess | What happens if it is wrong |
| --- | --- | --- |
| A snapshot carries top-level `generated_at` | The verified shape enumerated the payload, not the envelope, and the panel needs one instant to measure freshness against | The parse refuses, naming the field. The fix is the adapter stamping its read time; the document type does not change. |
| Upstream's `current_state.state` values | The verified shape named the field, not its vocabulary | The parse refuses, naming the value it found. Add it to `TASK_STATES` and to the `STAGE` map. |
| `priority` is `now`, `next` or `later` | The verified shape named the field, not its vocabulary | As above, in `PRIORITIES`. The document's own set is the panel's vocabulary and need not follow upstream's. |
| A pull request's checks | Upstream's `pr` carries the address and its source, and nothing about checks | `ChecksState` is `"unknown"` for every worker today. Filling it means reading the forge, which is the real-source worker's job - the field is here so that worker adds a reader rather than editing the document type under three other people. |
