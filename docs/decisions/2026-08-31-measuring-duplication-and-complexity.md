# qlty measures duplication and complexity, and nothing else

Date: 2026-08-31
Status: accepted

## Context

This project already has a linter and a test suite. `npm run lint` runs eslint,
`pretest` chains it, and `npm test` drives 463 tests plus the invariant checks
against the built server. What none of that measures is duplication or
complexity - the two debts that accumulate quietly because nothing ever fails on
them.

The timing decides the shape of this change. The panel has just taken on
nineteen vendored components under `src/ui/components/grok/` and had five of its
lenses rewritten in parallel over one afternoon. That is the situation
duplication creeps into, and a baseline is worth more before the next rewrite
than after it.

## Decision

qlty (CLI 0.644.0, local, no account) is configured in `.qlty/qlty.toml` to do
exactly one job: report duplication and complexity. Two commands:

```sh
qlty smells --all      # duplication and complexity findings
qlty metrics --all -d  # per-directory size and complexity totals
```

**No plugins are enabled.** `qlty init` offers six by default; every one of them
was declined, and the reason for each is below. Duplication and complexity are
computed by the CLI itself, so the enabled-plugin list being empty is the
configuration working, not a step left undone. The visible consequence is that
`qlty check` reports "No issues" on this repository by construction - that is
expected, and `qlty smells` is the command that has something to say.

**No formatter.** prettier, biome and oxc formatting all stay off. `qlty fmt`
is inert here and rewrites nothing; that was verified, not assumed.

**Every threshold is written out** in `.qlty/qlty.toml` rather than left
implicit. They are qlty's own defaults and none has been loosened, but a
contributor reading the file can see what is measured and at what number it
fires without having to run `qlty config show`.

## eslint stays with npm, and qlty does not touch it

qlty's eslint plugin installs its own eslint - the generated config pinned
9.39.5 - into its own sandbox, and resolves `eslint-config-next` there. This
project's eslint comes from `package.json` and reads `eslint.config.mjs`. Two
installs and two resolution paths answering one question is how a project ends
up with contradictory advice and no way to say which run is authoritative.

So: `npm run lint` remains the only thing that runs eslint, `pretest` keeps
chaining it, and qlty has no opinion about lint at all. There is no second
eslint configuration anywhere in the tree.

The alternative - qlty owning the run and `npm run lint` delegating to it - was
considered and rejected. It would put a downloaded toolchain in front of the
check that gates every test run, for no gain, since the eslint we have already
works.

## The other five plugins, and why each was declined

- **actionlint** and **zizmor** lint GitHub Actions. There is one workflow in
  this repository and it is twenty lines. Neither measures duplication or
  complexity. Worth revisiting if the workflow grows teeth.
- **trufflehog** scans for secrets. `npm test` already greps every tracked file,
  plus every uncommitted file that is not gitignored, for machine paths and task
  identifiers - see the "Nothing real in the repository" principle in
  `docs/principles.md`. A second scanner with different rules would give a second
  verdict on a question this project has already answered its own way.
- **osv-scanner** reports vulnerable dependencies. This is the one real gap
  among the six, and it is still declined here: it reaches the network on every
  run, which makes a local `qlty smells` fail or stall offline, and it asks a
  supply-chain question rather than a code-health one. Recommended separately -
  as Dependabot or a scheduled job, not wired into a developer's local run.
- **ripgrep** enforces custom grep rules. There are no custom rules to enforce.

## What the excludes say, and the trap in the generated ones

qlty's generated `exclude_patterns` list is twenty-five entries of boilerplate,
and one of them is `**/config/**`. In this repository that silently swallows
`src/config/` - real quarterdeck source, the layer that derives the port. It was
missing from the first metrics run and its absence is easy not to notice.

The committed list is therefore short enough to read in full, and holds only
what is genuinely not ours to measure: `**/*.d.ts` (generated, no logic) and
`tests/violations/**` (deliberately broken source read as text by the invariant
checks, which `eslint.config.mjs` ignores for the same reason). qlty already
skips whatever `.gitignore` skips, so `node_modules`, `.next/` and `dist/` need
no entry.

**Anything added to that list must be checked against `src/` first.** A
generated exclude pattern that matches a real directory is a measurement that
quietly stops happening.

## The baseline, taken 2026-08-31

80 files, 8,059 lines of code, 18 findings.

(Take the total from `qlty metrics --all` without `-d`. The per-directory
`TOTAL` row sums the rows it displayed, so a nested directory is counted inside
its parent and again on its own line - `-d --max-depth 3` reports 20,534 for the
same 8,059 lines.)

**Duplication: two clusters, and only one of them crosses a file.**

| Where                                                                 | What                                                                                                                                                              |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/ui/components/grok/grok-write.tsx` 51 and 66                     | 16 similar lines, mass 83. The `before` and `after` line maps, written twice.                                                                                     |
| `src/ui/disclosure-bar.tsx` 138 / `src/ui/landed/landed-lens.tsx` 178 | 22 similar lines, mass 86. `NothingOmitted` and `NothingLanded`: the same empty state, distinguishing "unreadable" from "genuinely empty", with different labels. |

Two clusters across five lenses rewritten in parallel is a good result, and the
second one is the interesting one: it is not careless copy-paste, it is the same
idea drawn twice, which is the shape that becomes a shared component later.

**Complexity: four functions and one file over threshold.**

| Where                                              | Count | Threshold |
| -------------------------------------------------- | ----- | --------- |
| `GrokProjectPicker` (`grok-project-picker.tsx` 33) | 34    | 18        |
| `KeyboardHelp` (`keyboard-help.tsx` 78)            | 33    | 18        |
| `GrokSettings` (`grok-settings.tsx` 85)            | 24    | 18        |
| `FleetPicker` (`fleet-picker.tsx` 83)              | 19    | 18        |
| `src/adapters/health.ts` (whole file)              | 86    | 50        |

Plus nine "many returns" findings at counts of 6 and 7 against a threshold of 6 -
`idleSinceMs`, `keyedAnswerLine`, `submitIntent`, `terminal read`, `recheck`,
`GrokThinking`, `GrokWorking`, `KeyboardHelp`, and `ago`. Most of those are
guard-clause parsers at a boundary, which is the shape `docs/principles.md`
asks for; they are noted, not indicted.

Nothing here was acted on. This change installs the measurement; acting on it is
a separate decision.

## Recommendation: do not exclude the vendored grok directory

The question was whether `src/ui/components/grok/` - code we own but did not
write - dominates the numbers badly enough to deserve a permanent exclusion.
Measured, it does not:

|                  | grok  | all of `src/` | grok's share |
| ---------------- | ----- | ------------- | ------------ |
| Lines of code    | 1,929 | 7,932         | 24%          |
| Total complexity | 195   | 837           | 23%          |
| Findings         | 6     | 18            | 33%          |

Its complexity per line is very slightly _better_ than the project average. It
carries a third of the findings on a quarter of the lines, which is a mild
over-representation, not a distortion - the number that would justify excluding
it is not there.

Two further reasons to keep it in. It is not carried untouched: it was
re-tokenised onto quarterdeck's palette, and `npm test` enforces that no
component carries a colour value, so it is edited here. And its duplication
finding is internal to `grok-write.tsx` - exactly what a future re-tokenising
pass would want to see rather than have hidden.

If the captain decides differently, the right mechanism is a scoped
`exclude_patterns` entry with a dated note saying why, not a blanket vendor
exclusion that the next vendored directory inherits by accident.

## Recommendation: no CI job yet, and here is what one would cost

No qlty job was added to `ci.yml`. Three reasons, the first of them mechanical:

**A gate is not a one-line job.** `qlty smells` exits 0 whether it finds
eighteen problems or none - verified. Smells do not participate in `qlty check`
either, even with `[smells] mode = "block"` - also verified, on this
configuration. So gating on duplication or complexity means emitting SARIF and
parsing it, or hand-rolling a threshold. That is real work, and it should be
done for a reason.

**There is no reason yet.** A gate today would gate a baseline of eighteen
untriaged findings. Either it fails every PR until someone bulk-suppresses it,
or it is set to a threshold above the current state, which makes it a ratchet
nobody chose. That is the check nobody acts on, which is worse than no check.

**The cost is not zero.** CI here goes green in 42-64 seconds. Adding a job that
downloads the qlty CLI on every pull request is a visible tax on a fast pipeline.

The shape to revisit, once someone has acted on the baseline, is diff-scoped and
informational: `qlty smells --upstream origin/main`, reporting only on what the
pull request changed, not gating, until the team has watched it across a few
pull requests and knows what it says. Gating comes after that, if at all.

## Recommendation: a formatter is a separate decision

This project has no formatter, and adding one is defensible - it would end a
class of review comment. It is deliberately not in this change. A
whole-repository reformat is a diff nobody can review, and it would collide with
a lens still being validated. If the captain wants prettier, it should land as
its own branch, on a quiet tree, with the reformat as a single commit that
touches nothing else.

## Trade-offs

**qlty is a second toolchain a contributor may not have.** Nothing in
`npm test`, `npm run build` or `npm start` depends on it, and nothing added here
fails when it is missing - qlty is a tool you reach for, not a gate you pass.
That is the point, and it is also the risk: a measurement nobody runs measures
nothing. The commands are named in `AGENTS.md` and at the top of
`.qlty/qlty.toml` so they are findable, but there is no mechanism keeping them
in anyone's habit. That is what the CI recommendation above would eventually fix.

**The baseline in this file goes stale.** It is dated for that reason. It is a
snapshot to compare against, not a live number; re-run the two commands rather
than trusting the tables here.

**Zero plugins means `qlty check` looks broken.** It reports "No issues" on any
input, forever, because it has nothing enabled to check with. Anyone evaluating
whether qlty is working here should run `qlty smells --all` instead. This is
called out at the top of `.qlty/qlty.toml` too.
