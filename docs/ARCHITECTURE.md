# Architecture

Agents, not people, will maintain this code for years. An agent reproduces
whatever patterns it finds, so the tenth change looks like the ninth, which
looked like a shortcut taken in the third. The counter is not a style guide but
boundaries a machine checks on every change. That is why this document is mostly
about rules, and why every rule below is a test rather than a convention.

## Layers

Seven positions, one direction. Dependencies point right, and only right.

    types -> config -> adapters -> domain -> runtime -> ui

- `src/types/` - the document the UI renders, and its version. Imports nothing.
  Three lenses read it, and each carries its own freshness; see
  `docs/decisions/2026-08-30-the-document-seam.md`.
- `src/config/` - which fixture set, which port, which policy. Environment and
  defaults only; parsing the environment is one of the three boundaries.
- `src/adapters/` - the only I/O. Exactly three files: `contract.ts` (the
  upstream boundary and the fixture source), `health.ts` (quarantined),
  `intent.ts` (the one permitted writer). Two of them read, and they fail
  independently - which is why the document carries a status per lens.
- `src/domain/` - the projection from snapshot and health reading to document.
  Pure.
- `src/runtime/` - watch, debounce, coalesce, cache, publish the change signal.
- `src/ui/` - server-rendered components. Reads the document, nothing else. One
  directory per lens - `fleet/`, `deck/`, `shipshape/` - so the worker building
  a lens edits no file another worker is also editing. `shell.tsx` lays the
  three out; `lens-frame.tsx` is the chrome they share.

Plus two positions off the line:

**`src/providers/`** is the single door for cross-cutting concerns: the clock
and the logger. Any layer may import it; it imports only `types`. It exists so
the projection can be tested with a fixed clock, and so nothing reaches for
`Date.now()` or `console.log` directly - which is itself checked.

**`src/app/` and `src/proxy.ts`** are the composition point. Next owns those
filenames, and invariant 6 keeps fleet reading out of `src/ui/`, so the wiring
has to live somewhere that is neither. Route files stay thin: read, translate,
hand to a component. This position may import from every layer, and it is the
only one that may. See `docs/decisions/2026-08-30-app-as-composition-point.md`.

The permission table is `ALLOWED_IMPORTS` in `tests/lib/invariants.ts`. That
table is the layer model; this prose describes it.

## The invariants

Each is a check wired into `npm test`, and each has a deliberately broken tree
under `tests/violations/` proving the check reports it. The checks are the
foundation everything else rests on, so they are themselves known-good.

| # | Rule | Why it exists |
| --- | --- | --- |
| 1 | Imports point forward only | Prevents the slow collapse into one tangled module |
| 2 | `src/domain/` performs no I/O | Keeps the projection testable against fixtures with no fleet present |
| 3 | Exactly one file may write anything: `src/adapters/intent.ts` | The whole safety argument for acting reduces to one reviewable file |
| 4 | Only `src/adapters/health.ts` may name fleet-internal paths | Confines the one unstable dependency |
| 5 | The contract version is pinned and parsed at the boundary | A changed contract refuses loudly rather than rendering something plausible and wrong |
| 6 | `src/ui/` imports only the document type and providers | Keeps the panel replaceable; stops fleet reading creeping into rendering |
| 7 | No network egress from the browser at runtime | A local tool that degrades without internet fails its own honesty rules |

Plus one beyond the seven, `provider-bypass`, which is the reason
`src/providers/` exists: nothing outside it reaches for the wall clock or the
console. `Date.parse` is pure and stays.

### invariant 1

Checked as the per-layer permission table. One exemption: `src/domain/` may
import from `src/adapters/` with `import type`, because a type-only import is
erased before anything runs and cannot carry behaviour - and the projection
needs the snapshot's shape to project it. A value import from adapters is a
violation and says so.

### invariant 2

Checked as: no `node:*` import anywhere in `src/domain/`. That is the whole
rule, and it is airtight - a module that cannot reach a Node builtin cannot
touch a filesystem, a process, or a clock.

### invariant 3

The one that matters most, and it is checked two ways. First, exactly one file
carries the `quarterdeck:permitted-writer` marker and it must be
`src/adapters/intent.ts` - a second file claiming it fails the build. Second,
every mutating API is banned outside that file: `writeFile` and its family,
`child_process`, `worker_threads`, `process.chdir`. Reads are untouched, so
`readFile` and `watch` stay legal everywhere adapters may use them.

Scope is `src/`. `bin/quarterdeck` is the launcher, not panel code: it stages
build output before the server exists, which is not the panel acting on a fleet.
`tests/` writes to temporary directories for the same reason.

### invariant 4

Checked as: outside `src/adapters/health.ts`, no string literal names an
absolute filesystem path, and nothing calls `homedir()`, `userInfo()`, or reads
`process.env.HOME`. Literals beginning `/api/`, `/_next/` or `/(` are the app's
own URL space, not machine paths, and are exempt.

`health.ts` carries a matching obligation: it degrades to an unreadable reading
rather than throwing when a path it names has moved. A quarantined module that
can take the panel down is not quarantined. The `health-dark` fixture set has no
health file at all, and the suite asserts the panel still renders three lenses.

The module has two sources: the fixture health file, and a running fleet's own
files when `QUARTERDECK_FLEET_HOME` names a home. The second is the reason the
quarantine exists - every path and both policy thresholds it needs are inside
that one file, and each of the three signals degrades on its own, so a beacon
that moved leaves the other two working. `docs/contract.md` records where each
signal comes from; `fixtures/homes/` holds synthetic homes for the suite to
break, including one where upstream has restructured entirely.

### invariant 5

Checked statically - `SNAPSHOT_SCHEMA_ID` must be declared as a literal and
actually compared - and behaviourally, by running the built panel against the
`mismatched` fixture and asserting it renders the refusal naming both
identifiers and no part of the fleet.

### invariant 6

Checked as invariant 1's table with a stricter row: `src/ui/` may import
`src/types/` and `src/providers/`, its own files, and npm packages. Nothing
else. A component that needs a new value gets it added to the document type,
filled in by the projection, and passed down as a prop.

### invariant 7

Checked statically - no `next/font/google`, no remote URL literal in `src/` -
and enforced at runtime by a Content-Security-Policy in which every directive
resolves to `'self'`. Fonts are committed woff2 subsets under `src/ui/fonts/`.

## The refresh loop

1. The runtime watches the fixture directory, debounced and coalesced.
2. On a change it publishes one signal over server-sent events. **The signal
   carries no data.**
3. The page asks the server to re-render.
4. The server re-renders and streams back; React reconciles in place.

The point of keeping the data out of the signal is that an expanded panel stays
expanded, the scroll does not jump, and a card being read is not rebuilt
underneath the reader. Sending the document down the pipe instead would make the
client rebuild the page from data, which is what makes cards flicker.

Rules that come with the pipe, all in `src/runtime/fleet.ts`:

- One fleet read is ever in flight; concurrent callers share it.
- Overlapping triggers coalesce into one read.
- A read has a hard timeout.
- Last-known-good is retained and shown with its staleness, never replaced by an
  error - except for a schema mismatch, which is never survivable.
- Health is read on every pass and independently of the snapshot, so a snapshot
  that will not parse leaves the shipshape lens current rather than dragging it
  down with the other two.
- `EventSource` reconnects on its own, so a restarted server heals without a
  reload.

The runtime is a singleton hung off `globalThis`, because route modules can be
evaluated more than once in a process and two watchers would publish every
change twice.

## Security

The panel will act on the fleet later, so the server carries this from the first
commit even while it only reads:

- Bound to loopback only.
- Every request's `Host` is checked, and its `Origin` when the browser sends
  one. Loopback is not a boundary against a page in the operator's own browser:
  any site can point a form at `http://127.0.0.1`.
- A session secret minted at start. Everything under `/api/act` requires it;
  reading requires none of it. The guard is in front of a write path that does
  not exist yet, so no build ever ships an acting route without it.
- No cross-origin sharing headers, so another page cannot read a response.
- An `Intent` carries a `requestId`, so a retry or a double click cannot act
  twice.

## Tests

`npm test` lints, runs the invariant checks, and drives `.next/standalone` -
the built server, not `src/`, so a stale build cannot pass. A freshness guard
fails first and says to rebuild.

`tests/document.test.ts` is the exception, and deliberately: it walks every
fixture set and asserts the document each produces, against the pure projection
rather than the server. The document is the seam several workers build against
at once, so a change to its shape has to break a test there rather than surface
later as a lens quietly rendering nothing.

Behavioural tests copy `fixtures/` to a temporary directory before changing
anything, take a port derived from the worktree plus a per-file offset, and pin
`QUARTERDECK_NOW` where staleness is under test, so nothing races the clock.

Scroll preservation is the one claim not asserted here: it is React's
reconciliation contract, and it is demonstrated in a browser instead. See
`docs/plans/done/`.
