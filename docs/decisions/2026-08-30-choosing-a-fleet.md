# The fleet list is configuration; the fleet on screen is a cookie

Date: 2026-08-30
Status: accepted

## Context

The panel read one fleet: the one named by `QUARTERDECK_FLEET_HOME`, or the one
fixture set named by `QUARTERDECK_FIXTURE_SET`. An operator who runs more than
one fleet had to restart the panel to look at the other, and got no help
remembering which one they meant.

Two questions had to be answered separately, and conflating them is the mistake
this record exists to prevent.

**Which fleets can be looked at** is a fact about the machine. It is the same
for every browser pointed at this panel, it is the operator's setting rather
than their preference, and it is exactly what the reader already had a notion
of: a fleet home whose snapshot command is run, or a committed fixture set.

**Which one is on screen** is not. It is a view, held by whoever is looking.

## Decision

**The list is configuration, and keeps the reader's notion of a fleet.**
`QUARTERDECK_FLEET_HOME` and `QUARTERDECK_FIXTURE_SET` each take a
colon-separated list. Nothing new decides what a fleet _is_: a fleet's identity
is still its home path or its fixture set name, and `id` and `label` in
`FleetRef` are derived from that one identity rather than being a second one. A
home wins over the fixture sets exactly as it always did.

**The choice is a cookie.** The panel writes nothing outside
`src/adapters/intent.ts` and this did not change that. A file recording which
fleet the operator last looked at would have been a second writer's worth of
risk for a preference, and it would have been wrong on its own terms: two
browsers pointed at the same panel may honestly want different fleets, which a
machine-wide file cannot express. The cookie survives a panel restart because it
was never on this machine to begin with.

The costs, accepted: clearing site data forgets the choice, and a browser with
cookies blocked always opens on the first configured fleet. Both degrade to the
default rather than to an error, and neither is worth a writer.

**The picker owns the content it labels.** `src/ui/fleet-picker.tsx` wraps
everything the panel draws - the contract refusal included, because a fleet this
build cannot read is one an operator especially needs to select away from. Which
fleet is marked as showing comes from the server prop the content was rendered
from, so it cannot move ahead of the content; while the operator's click and
that prop disagree, the panel names both fleets in words and dims what is below.

This is why the control is not a `<select>`. A select moves its own value the
instant it is clicked, before the server has read anything - the new fleet's
name sitting above the old fleet's numbers. Three bugs in this project have
been the panel asserting something it had not established, and a control that
lies for a round trip would have been the fourth. It was a row of chips at
first; the terminal grammar redrew it as a disclosure holding a real
radiogroup, for layout reasons unrelated to this one - see
`docs/decisions/2026-08-31-the-terminal-grammar.md`.

**One runtime per fleet.** Each carries a cache and a last-known-good, so a
single shared runtime would answer a request for one fleet out of another's last
read. `tests/fleet-switch.test.ts` interleaves two fleets' requests on one
server and asserts every response is internally consistent, which is the
assertion that fails if this is ever collapsed back into one.

## Alternatives considered

**The selection in the URL.** Honest, linkable, and testable without a cookie -
but then remembering it means the operator bookmarking a URL, or the server
setting a cookie anyway on the way past. It solves the harder half of the
problem and leaves the easy half.

**Discovering fleets on disk.** Scanning for fleet homes would have meant
inventing a notion of where fleets live, which is a shared-contract question and
not a switcher's to answer. Configuration already says which fleets exist; it
only had to be allowed to say more than one.

**A file recording the choice.** Rejected above: a second writer for a
preference, and wrong about who the preference belongs to.
