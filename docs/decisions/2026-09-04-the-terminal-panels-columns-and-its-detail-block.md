# The terminal panel's columns, and the block that explains one row

2026-09-04

## What was decided

`quarterdeck-tui` draws its list as a table of fixed columns with one selected
work item explained in full underneath it, instead of one delimiter-joined
sentence per row.

At a hundred columns and wider:

```text
quarterdeck / woot  4 active                                             snapshot 8s old
2 working | 2 waiting                      run access: 0 ready | 1 no run | 3 repo setup

  #  STATE    RUN         PROJECT       WORK
  1  working  no run      almanac-app   almanac account 214: automation Send…since 2099-01-02
  2  waiting  repo setup  harbour       node-agent-hsh: btrfs /@/var mounted…inbound webhooks
  3  working  repo setup  harbour       node-agent-nbg1-qzx cordoned 39h with the upgrade Plan
> 4  waiting  repo setup  harbour       cluster almanac (k8s.example.test): …e tenant services

selected 4/4
title   : cluster almanac (k8s.example.test): read-only cluster diagnostic, focus on the
          beacon tenant services
state   : waiting (fleet: paused)
project : harbour
activity: pull request 56 updated with the cleanup, waiting on the captain's merge decision
run     : repo setup -- Enter unavailable
reason  : repo not initialized (run 'no-mistakes init' first)

j/k select  enter attach  r refresh  q quit
```

Below about a hundred columns the same fields are drawn over two lines - the
metadata first and an indented title preview second - rather than squeezed into
one.

## What the old row got wrong

The row was `title - project - state - action or reason`, assembled and then
truncated as one line. Against a real fleet of long incident titles that
produced four failures at once. The least comparable field, the title, took the
left of every row, so the state and whether Enter opened anything never sat at
the same offset twice. Three rows repeated the same corrective sentence -
`repo not initialized (run 'no-mistakes init' first)` - which was most of the
screen saying one thing. Truncating the assembled line meant the fields at the
end were the ones that vanished, so a narrower terminal erased the action
category itself. And the selection was one `>` against four dense sentences.

The fix for the first three is the same: put the comparable fields where they
can be compared, and say the uncomparable thing once, about the row the
operator is actually on.

## Why a short label and one full reason

A refusal is two facts wearing one sentence. What kind of refusal it is decides
whether an operator can do anything about it, and belongs in a column. What
exactly to do about it belongs beside the one row they are looking at.

So a row draws `repo setup`, `no run`, `worktree gone`, and the detail block
carries no-mistakes' own words, whole and wrapped. The list gained a column of
comparable values, and the exact sentence lost nothing - it moved from being
printed three times, elided, to being printed once, complete.

## Why the kind is a value and not a match on prose

`nomistakes.Availability` is decided where no-mistakes' output arrives, in
`tui/internal/nomistakes`, and travels beside the sentence on `Attach`.

The renderer must never be the thing that decides `repo not initialized` means
`repo setup`. That would make the drawing code a second, undeclared parser of
somebody else's human-readable prose, and the day upstream rewords a message
the column would silently go blank while the sentence beside it stayed right.
Placing a refusal is boundary work, and the boundary package is where every
other fact about no-mistakes' surface is already decided.

Two refusals earn a kind of their own because the operator's next move differs:
a repository nobody initialised is one command from working, and a daemon that
is down is not this row's problem at all. Everything else is `error` with its
sentence intact. Inventing more kinds from prose would be claiming structure
upstream has not published.

`Attachable()` stays the authority on what Enter does; the label follows it, so
a value assembled without a kind can never read as `ready`.

## Why the state column is not the fleet's own word

The fleet's vocabulary is exact and written for the fleet: `pr_open`,
`waiting_external`, `parked`. An operator scanning a column wants to know who
is moving, who is waiting and who wants them, so the list draws `PR open`,
`waiting`, `needs you`.

That is a reading aid, and a reading aid that hides its source is worse than
none - it makes the column impossible to check against `docs/contract.md`. So
the detail block keeps upstream's own term whenever the mapping changed it:
`waiting (fleet: paused)`. A state this build has never heard of reads
`unknown` and keeps its raw word, which is the same rule `fleet.ActiveRows`
already follows by keeping such a worker on the list at all.

## Why the age comes from the snapshot, and what it does when it cannot

The header says `snapshot 8s old` from the snapshot's own `generated`, which
was already decoded and thrown away before drawing. The list refreshes on its
own clock and a handover can hold it still for minutes, so "when did the fleet
look" and "when did this program last ask" are different questions, and only
the first tells an operator whether to trust the screen.

A snapshot carrying no readable instant reads `snapshot age unknown` rather
than being dated from the read that fetched it. An invented age is worse than
no age, because it looks like a measurement.

A snapshot dated ahead of this clock reads as new rather than as a negative
age. That is the ruling `docs/decisions/2026-08-31-the-precision-a-date-carries.md`
settled for the web panel, and it is why the fixtures are dated in 2099: so
they never drift into looking stale.

This supersedes the closing paragraph of
`docs/decisions/2026-09-03-the-terminal-panel-and-the-handover.md`, which said
the terminal panel draws no snapshot age.

## Why the shrinking is measured rather than scripted

The order fields give way in is the priority order - title preview, then
project, then the column alignment, then the place in the list, and never the
state or what Enter will do. But it is not a table of widths written down
somewhere: each field is appended only while it still fits, and the order falls
out of which one is measured last.

That means the exact width a field leaves at depends on the fleet - a fleet of
short project names keeps its project column longer than one of long ones -
and the guarantee is the order, not the number. The header is the one part that
does not follow the same sequence: its second line is the widest thing on
screen for most fleets, so it collapses to `4 active | 0 ready | 8s old` before
any row gives anything up. Collapsing a row's project at ninety columns to
honour a literal order would be spending width nothing needed.

## Why the layout fixture is synthetic

The capture that started this carries a real fleet's incident titles. The
fixture that reproduces it, `tui/internal/ui/testdata/four-active.json`, has
the same four rows, two states, two projects, title lengths and punctuation,
and none of the content: this repository's fixtures carry zero real data, which
is the rule `fixtures/README.md` states for the web panel's own sets and which
the terminal panel's existing `testdata` already follows. What is being tested
is the layout, and the layout cannot tell the difference.

## The cost

The panel is taller. The detail block adds seven or eight lines to a screen
that used to be a header, a list and a footer, and nothing here scrolls: on a
short terminal with a long list the top is what leaves. That is the right end
to lose - the footer and the selected row are the two things an operator is
reading - but it is a real change from a panel that always fitted.

Below about twenty columns nothing is left to shed and a row is cut from its
tail, which can take the run label. That is well under the forty-eight columns
the layout is designed to stay useful at, and it is the only place the old
whole-line truncation still happens.

`no-mistakes axi status` is still read once per work item per refresh, and the
kind costs nothing extra - it is decided from an answer already in hand.
