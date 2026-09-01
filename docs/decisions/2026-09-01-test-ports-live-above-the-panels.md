# Test ports live above the panels, in a band of their own

Date: 2026-09-01
Status: accepted

Supersedes the "Changing the derivation or the range" alternative in
`docs/decisions/2026-09-01-a-suite-owns-its-ports.md`, which rejected a
test-only range on an argument that holds for one collision and not the other.

This file's title is also the arrangement as it was on the day. The panels
have since moved below the suite, to 28000-28999, and the two bands are
disjoint from that side now; see
`2026-09-01-the-panel-band-clears-every-kernel.md`.

Every "46000-46999" below is the range as it was on the day: the band moved
again, to 29000-29999, in `2026-09-01-the-band-still-sat-in-the-kernels-range.md`.
The reasoning here - a band disjoint from the panels - is unchanged; only where
that band sits moved, because "above the panels" turned out not to be "clear
of the kernel" on Linux.

## Context

On 2026-09-01 a worker running `tests/real-fleet.test.ts` in a disposable
worktree derived port **45229** and found the primary checkout's panel on it. The
guard from `a-suite-owns-its-ports` refused loudly and named the occupant, which
is that guard working. The question left over was why the collision existed.

Two readings were plausible, and they lead to opposite fixes: either two paths
genuinely collide under `derivePort`, in which case the range is too small; or
the derivation is being fed something other than the worktree path, in which
case the hash is innocent. Both are wrong.

### What the two derivations actually are

```console
derivePort(<the primary checkout>)   -> 45229
derivePort(<the disposable worktree>) -> 45659
```

The panel on 45229 was identified by working directory, not command line -
`lsof -a -p <pid> -d cwd` - and it is the primary checkout's, deriving exactly
the port it should. The worktree derives 45659. **The two panel ports do not
collide**, and `REPO_ROOT` - `join(import.meta.dirname, "..", "..")` - is the
worktree root, so nothing was hashing the wrong thing either.

The number 45229 was never a panel port in that worktree. It was a **test**
port. `portAt` mapped an offset through

```ts
((PANEL_PORT - PORT_RANGE_START + offset + 100) % 900) + PORT_RANGE_START + 50;
```

into 45050-45949 - inside the same thousand `derivePort` puts every checkout's
panel in. Replaying the allocator for each worktree on this machine reproduces
the report exactly:

| checkout              | its panel | what lands on 45229          |
| --------------------- | --------- | ---------------------------- |
| the primary one       | 45229     | (its own panel)              |
| a disposable worktree | 45659     | `real-fleet.test.ts` port #0 |
| another               | 45863     | `fleet-lens.test.ts` port #4 |
| another again         | 45621     | `security.test.ts` port #6   |

So it is neither branch. The hash is fine; the input is fine; the **two
populations shared one thousand ports**.

### How often that costs a run

The suite draws 91 ports across 21 files, and reserves 464 (29 files at
`BLOCK_SIZE` 16). A foreign panel is uniform over the 1000-wide panel range, so
per other checkout:

| other checkouts running a panel | hits a port in use | hits a reserved port |
| ------------------------------- | ------------------ | -------------------- |
| 1                               | 9.1%               | 46.4%                |
| 4                               | 31.7%              | 91.7%                |
| 8                               | 53.4%              | 99.3%                |

The machine this was found on had eight disposable worktrees plus the primary
checkout. **A little
over half of runs meet a foreign panel already, and once files grow into their
blocks it is a near certainty.** That is not bad luck, and it is not a hash
collision - it is two schemes sharing an address space.

For contrast, the collision the range was actually sized against: nine checkouts
drawn into 1000 ports collide by birthday about 3.5% of the time, and the nine
real paths on this machine derive nine distinct ports. **The panel range is not
the defect and does not move.**

## Decision

**The suite derives into 46000-46999; panels keep 45000-45999.** Two disjoint
bands, `tests/lib/band.ts`.

This is not "lower the odds". A panel cannot land on a test port at all, in any
checkout, because `derivePort` cannot reach above 45999 - one property of two
constants, checked by a test rather than argued. The panel range is untouched,
so no operator's URL moves.

**The rotation survives, the dodges do not.** `portAt` is now

```ts
TEST_BAND_START +
  ((derivePort(REPO_ROOT) - PORT_RANGE_START + offset) % TEST_BAND_SIZE);
```

The `+100`, the `+50`, the 900-wide window inside a 1000-wide range, and the
push a full window clear when an offset landed on `PANEL_PORT` all existed only
because the bands overlapped. The same hash still rotates each checkout to a
different place in the band, which is what kept two checkouts' suites apart and
still does.

**What a band cannot fix stays fixed by the guard.** Another checkout running
_this same suite_ derives into this same band, and no partition helps: both
sides are the same code. `startPanel`'s occupancy check is what covers that, and
it is untouched - its message now says a sibling _suite_ rather than "a panel or
a suite", because the panel half is gone.

## The proof

The primary checkout's panel was left running on 45229 throughout. With the old
`portAt`, `tests/fleet-lens.test.ts` in this worktree draws that port on its
fifth panel and the guard refuses:

```console
$ lsof -a -p $(lsof -nP -iTCP:45229 -sTCP:LISTEN -t) -d cwd
  ...  <the primary checkout>/.next/standalone

$ node --test tests/fleet-lens.test.ts        # old portAt
✖ says the read failed rather than dating the content from it
  Error: port 45229 is already answering, and this suite did not start what is on it.
ℹ pass 41
ℹ fail 1

$ npm test                                    # new band, same panel still up
ℹ tests 478
ℹ pass 478
ℹ fail 0

$ lsof -nP -iTCP:45229 -sTCP:LISTEN -t        # unchanged: the panel is untouched
```

`tests/harness.test.ts` holds the same thing as an assertion. Against the old
`portAt` it fails on the first port it checks - `answering-fleet.test.ts` would
use 45113 - and it needs no running panel to say so.

## Why the earlier rejection was wrong

`a-suite-owns-its-ports` rejected "changing the derivation or the range" with:
_"a wider range or a test-only range would lower the odds of an overlap without
changing the failure when one happens"_, and _"any block wide enough to exclude
every sibling would be the whole range"_.

Both are true of **panel versus panel**, and of **suite versus suite**: those
populations are symmetric, every member derives by the same rule, and nothing
can be reserved from a process you do not know about. Neither is true of
**panel versus suite**. Those are two different derivations in one codebase, and
giving them disjoint outputs is a change of kind, not of odds. The doc reached
one conclusion over a case it had not separated - understandably, since it was
written to fix the diagnosis cost and the collision it had in hand was a suite
meeting a panel.

The rest of that decision stands entirely. The guard is why this was a named
occupant instead of a fourth wrong diagnosis, and it is still the only thing
standing between the suite and a sibling suite.

## Consequences

Reported ports move: the suite now answers on 46000-46999. Nothing names one, so
nothing else changes.

The band holds 62 files at `BLOCK_SIZE` 16, up from 56, and `allocate` still
refuses overflow loudly.

`tests/lib/band.ts` exists as a leaf module rather than living in
`tests/lib/ports.ts`, because `ports.ts` already imports `REPO_ROOT` from
`server.ts` and `server.ts` needs the band for its refusal message; a constant
both import is one module, not a cycle.

`tests/harness.test.ts` asserts the property directly - every port the allocator
can hand out lies outside `PORT_RANGE_START`-`PORT_RANGE_START+PORT_RANGE_SIZE`.
It fails against the old `portAt` on the first port it checks.

## Alternatives considered

**A test that says "a worktree and the primary checkout must not derive the same
port".** The brief asked for this, and it is the wrong assertion: it names two
paths, passes today for the wrong reason - they never collided - and says
nothing about the eight other worktrees or the ninth checkout added tomorrow.
The property that has to hold is over the ranges, and needs no paths at all.

**Widening 45000-45999 instead.** Reduces every collision a little and removes
none. It also makes the remaining ones rarer and therefore harder to find, which
is the objection `a-suite-owns-its-ports` raised and which still stands.

**Deriving test ports from something other than the path.** The rotation is the
only reason two checkouts can run the suite at once. Removing it trades the
collision that is now impossible for one that is currently rare.
