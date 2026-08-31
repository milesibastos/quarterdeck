# Reading the forge: opt-in, off the critical path, once a minute

Date: 2026-08-31
Status: accepted

## Context

The document has carried `ChecksSignal` and `ReviewSignal` since version 4, both
with three arms, and every pull request on every real read has said
`not-looked-up`. That was honest - `docs/quality.md` recorded it as "nothing
missing upstream, the read simply has not been built" - but it left the card
unable to answer the question an operator opens a pull request to answer: are
the checks green, and is anybody waiting on me.

Upstream will not close this. `bin/fm-fleet-snapshot.sh` publishes `pr` as
`{ url, source }` and nothing more, confirmed against two live homes on
2026-08-31. Waiting for four more keys in the snapshot means waiting for a fleet
to grow a network client, which is a larger change to a more critical program
than the one being avoided here.

Everything else the panel reads is on this machine and costs a file open. This
is the first thing it reads that costs a network call, and the first that can be
slow, refused, or rate-limited by somebody else. That difference is what the
whole decision is about.

## Decision

**The panel asks `gh`, through the one spawn door.** `src/adapters/forge.ts` is
the fourth adapter. It runs `gh api graphql` with the pull request's own address
and turns the answer into the two `Snapshot*` blocks the parser already knows.
Adding an HTTP client and a credential store to a panel whose security argument
is that it has neither was never on the table; `gh` already knows how to reach a
forge, how to authenticate, and how to resolve an address. The command is a bare
name, resolved through the child's `PATH`, so nothing here names a machine path.

**One question, by URL.** `resource(url:)` means nothing takes a forge address
apart into an owner, a repository and a number - the part that breaks on the
first address shaped differently - and one call answers for both the checks and
the comments. `__typename` on each author is why it is a query rather than
`gh pr view --json comments`: that surface reports an author as a bare login,
and a continuous-integration bot is then indistinguishable from a person. The
document promises comments "a person left".

**Opt-in, by configuration.** `QUARTERDECK_READ_FORGE`, off by default, refused
rather than defaulted when it is neither on nor off. Not a control in the panel:
`src/ui/` may not read anything (invariant 6), and the one write path executes
nothing. A panel that quietly started calling a forge on every refresh would be
spending an operator's rate limit without having been asked.

**Off the critical path, always.** `src/runtime/forge.ts` applies what it has
already read and *then* schedules; a render is never awaiting a network call.
The first paint costs exactly what it cost before this existed, and a pull
request nothing has read yet keeps saying `not-looked-up` - which is true of it
at that moment, not a placeholder. A completed read publishes one change signal
and the panel re-renders the way it does for any other change.

**At most once a minute, per pull request, failures included.** The floor is
stamped when a read is *scheduled* rather than when it finishes, so several
renders in the same instant schedule one read between them, and a forge that is
refusing is asked again in a minute rather than on every render. Reads run one
after another: nothing is waiting on them, so concurrency would buy only a burst
of simultaneous calls to one forge, which is the shape that gets an operator
rate-limited.

**Upstream's own reading always wins.** The cache fills only the blocks upstream
left out. A fleet that grows its own forge reading is closer to the work and
costs the panel nothing, so the day that arrives this quietly stops doing the
work rather than fighting it.

**A failure is `unreadable`, never `not-looked-up`.** No `gh`, no credentials,
an address the forge will not answer for, a timeout - all of them are reads that
happened and did not work, and the operator can act on each. Saying nobody asked
would be a lie about what the panel just did.

## Consequences

**Invariant 7 is unchanged, and this is worth being explicit about.** The rule
is that nothing is loaded from the network *in the browser*: the
Content-Security-Policy still resolves every directive to `'self'`, no font or
library is fetched, and the page still renders with no internet at all. What
runs here is a server-side command the operator opted into, off the first paint,
whose failure is a line on a card. The static check - no `next/font/google`, no
remote URL literal in `src/` - passes untouched, because there is no URL literal
in this code: the address comes from the document.

**`src/adapters/` is four files, not three.** The count was never the rule; "the
only I/O, and you can list it" was. The forge is a different upstream with a
different promise from `contract.ts` - one either parses or refuses, the other
may simply not answer - so folding it into that file would have put two
reliability promises in one boundary, which is the mistake the per-lens status
exists to avoid one layer up.

**The floor is a constant, not a setting.** One minute, in
`src/runtime/forge.ts`. A number nobody sets is configuration nobody asked for;
if an operator ever needs a different one, that is the day it becomes a setting.

**A review left with only inline comments is not counted.** The count is issue
comments by a person plus reviews by a person that carry a body. A review
submitted with nothing but inline code comments carries no body and is missed,
which understates by one on a pull request somebody has already engaged with.
Counting bodiless approvals instead would overstate in the other direction, and
"approved without a word" is not a comment. Recorded in `docs/quality.md`.

**A pending run of more than a hundred checks understates its own progress.** A
rollup that is not pending means every check reported, so a finished run counts
exactly however large it is. Only a pending run past the forge's page bound is
approximate, and it is approximate in the safe direction.

## See also

- `src/adapters/forge.ts` - the read, and why it never throws.
- `src/runtime/forge.ts` - the cost rule, in one file.
- `tests/forge.test.ts` - the cost rule proved against a stub and a clock the
  test moves.
- `tests/fleet-lens.test.ts` - the same rule proved end to end, against a `gh`
  on the panel's own `PATH` that is a shell script.
- `docs/contract.md` - the two signals, and why `not-looked-up` is a value.
