# qlty formats the tree, runs five checks, and gates on all of them

Date: 2026-08-31
Status: accepted, superseding the version of this file dated earlier the same
day

## What this file used to say, and what changed

The first version of this record configured qlty to do exactly one job - report
duplication and complexity - and argued, at length, for declining everything
else: no plugins, no formatter, no CI job. That argument is reversed here, on
the captain's ruling that it goes all the way, and the reversal is written into
this file rather than left as a record contradicting its own repository.

Two things from that version survive intact, and one of them is the reason the
reversal is not total:

**eslint stays with npm.** qlty's eslint plugin installs its own eslint into its
own sandbox and resolves `eslint-config-next` there. This project's eslint comes
from `package.json` and reads `eslint.config.mjs`. Two installs and two
resolution paths answering one question is how a project ends up with
contradictory advice and no way to say which run is authoritative. `npm run
lint` remains the only thing that runs eslint, `pretest` keeps chaining it, and
qlty has no opinion about lint. Nothing below changes that.

**The trap in the generated excludes.** `qlty init` produces twenty-five entries
of boilerplate and one of them is `**/config/**`, which in this repository
silently swallows `src/config/` - real quarterdeck source. Anything added to
that list must still be checked against `src/` first.

What is now false in the old version, and should be read as history: "no plugins
are enabled", "no formatter", "no CI job", the recommendation that a gate is not
worth building yet, and the baseline tables, which were taken before the
exclusions were narrowed and before the tree was formatted. The live numbers are
`qlty smells --all` and `bin/qlty-smells-gate`.

## The formatter, and where prettier comes from

prettier comes from qlty and from nowhere else. There is no prettier in
`package.json`, deliberately, and the version is pinned in `.qlty/qlty.toml`.

The eslint argument above does not carry over, and it is worth saying why rather
than inheriting the conclusion. That argument is about an **incumbent**: eslint
was already here, with its own config and its own resolution, and adding a
second one would have created two answers where there was one. prettier has no
incumbent. Installing it twice - once for an `npm run format` and once for the
gate - is how we would manufacture that problem, not avoid it. One install, one
version, and the binary that formats the tree is the binary that fails the
build.

The cost, stated plainly: a contributor's editor has no local prettier to point
format-on-save at, and `npm test` does not check formatting. `qlty fmt` is the
command and CI is the backstop, and neither is discoverable from
`package.json` - which is why both are in `AGENTS.md`.

The first pass rewrote 119 files. It is its own commit, with no behavioural
change in it, so the mechanical diff and the reviewable diff are never mixed.

## `exclude_patterns` had to shrink before any of this worked

This is the change with the widest blast radius, and it is not obvious from the
outside.

`exclude_patterns` is global: a path named there is invisible to the formatter,
to every plugin and to `qlty smells` alike. Six paths were listed, and four of
them were there to silence a complexity or duplication finding, from when smells
was the only consumer - `src/adapters/health.ts`, `src/ui/keyboard-help.tsx`,
`src/ui/fleet-picker.tsx` and the vendored `src/ui/components/grok/`. Enabling a
formatter and a secret scanner against that list would have left roughly two
thousand lines of real source unformatted in a formatted tree, and unscanned in
a public repository. Verified rather than assumed: with those entries in place,
prettier reported 69 files to format; without them, 137.

So the list is cut to two entries - `**/*.d.ts`, which is generated and carries
no logic, and `tests/violations/**`, which is discussed on its own below. The
four reasons the others carried are not discarded; they move to
`bin/qlty-smells-gate`, where the finding is judged rather than the file hidden.

There was no gentler mechanism. Three were tried against smells and all three
failed:

| Mechanism                               | Result                                 |
| --------------------------------------- | -------------------------------------- |
| Inline `qlty-ignore` comment            | Linter pipeline only. Tried in #29.    |
| `[[exclude]]` with `plugins = ["qlty"]` | No effect; `health.ts` still reported. |
| `[[triage]]` with `set.ignored = true`  | No effect; same.                       |

All three are machinery `qlty smells` never consults. Per-plugin `[[exclude]]`
blocks do work for plugins, and are used for the three places one tool needs to
be told to look away.

## What is excluded, and at what scope

Everything qlty is told to overlook now names the narrowest thing that works.

**Global, from all of qlty:** `**/*.d.ts`, and `tests/violations/**`.

That second entry is load-bearing, and it is the one hazard in this whole
change. Those files are deliberately broken source read as **text** by the
invariant checks, and `tests/invariants.test.ts` asserts the exact line each
planted fault sits on. A formatter reaching them would move those lines. eslint
and `tsconfig.json` ignore the directory for the same reason; a prettier run
wired through npm would have inherited neither.

Two things were measured about it, and both are better news than expected:

- prettier wants to rewrite **none** of the twenty planted trees as they stand.
  `prettier --check` passes on all of them. The exclusion guards what someone
  writes next rather than a bullet this pass dodged.
- If it ever did reach them, most breakage would be **loud**. The suite pins
  exact line numbers for `path-quarantine` and `no-egress`, and its per-check
  loop asserts every tree still trips its check at all. The quiet shape left is
  a tree whose fault a formatter relocates within a check that does not pin the
  line - which is why the exclusion stays.

The mechanism was demonstrated rather than argued: a fault planted across three
lines in the `path-quarantine` tree failed the suite at 13 pass / 1 fail;
prettier joined the lines; the suite went green again on a file its author had
not written.

Separately, the checks were shown to be alive after the format pass. A raw hex
colour planted in `src/ui/snapshot-badge.tsx` and a remote URL planted in
`src/domain/project.ts` each failed the invariant suite naming the rule and the
exact line.

**Per plugin:**

| Path                                                                  | Kept from                        | Why                                                                                                                                                             |
| --------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixtures/all-dark/snapshot.json`, `fixtures/malformed/snapshot.json` | prettier                         | Truncated mid-token on purpose. prettier exits 2 for the whole run rather than skip them.                                                                       |
| `.agents/**`                                                          | prettier, markdownlint, yamllint | Installed by the shadcn CLI, integrity pinned in `skills-lock.json`. The first format pass rewrote eighteen of these before the entry existed; it was reverted. |
| `fixtures/**`, `CLAUDE.md`                                            | markdownlint                     | A fleet home's `backlog.md` is data the panel reads, not prose. `CLAUDE.md` is a three-line import stub with nowhere to put a heading.                          |

## The five checks, and what each settled

Each answers a question nothing else in this project answers. Configs live at
the repository root: `.qlty/configs/` was tried first and this CLI does not read
it, which fails **silently** - the run reports exactly what it would with no
config at all.

**markdownlint.** 69 tracked `.md` files and nothing had ever read them. 212
findings, 201 of them MD013 against table cells and code blocks. `docs/quality.md`
is one row per area with a sentence-heavy cell, the longest over 3,000
characters, and markdown gives a cell no way to wrap; code blocks quote commands
verbatim. Both are exempt and the 80-column limit stays for prose, which left 14
real over-long lines - rewrapped, not excused - plus two indented code blocks
fenced, two fences given a language, and one heading's trailing full stop
removed.

markdownlint's own formatter runs beside prettier and the two converge: three
consecutive `qlty fmt --all` runs give a byte-identical tree. It wraps three
bare URLs in a font copyright notice in angle brackets, which leaves the
_rendered_ notice verbatim, so MD034 stays on rather than being switched off to
protect the source text.

**actionlint.** Clean on the first run, and now guarding the file that gates
every pull request.

**yamllint.** Reads the workflow as YAML where actionlint reads it as a
workflow; they overlap nowhere. Six findings. `document-start` is off - `---`
opens a document in a stream and every YAML file here is a single document.
`truthy` is narrowed to values with `check-keys: false`, because a workflow's
`on:` key is required and YAML 1.1 reads it as a boolean. The three long lines
were a comment that had grown, and were rewrapped.

**gitleaks.** This repository is public. The leak guard in `npm test` knows this
project's own leak shapes - machine paths, task identifiers - and nothing about
an AWS key or a GitHub token. Different question, and gitleaks is the only thing
here that asks it. Clean.

The old record declined **trufflehog** on the grounds that the leak guard
already answers this. That reasoning was wrong about which question is being
asked, and gitleaks is enabled in its place.

**knip.** Dead exports and unused dependencies. Nothing else looks: eslint sees
one file at a time and cannot know an export has no importer. 77 findings, and
most were the tool not knowing the project's shape. Naming the Next entry
points, the test files, the vendored component directories and - the one that
mattered - `src/app/globals.css` took it to one. That CSS entry is what
resolved `shadcn`, `tw-animate-css` and `tailwindcss`, whose only use is an
`@import`: three dependencies kept because they are used, rather than
suppressed. `postcss` is the single ignored entry, because no source file
imports it.

What survived was real, and was fixed: 51 symbols exported from a module nothing
else imports, one constant referenced nowhere at all, and `lucide-react`.
`docs/principles.md` already asked for this under "do not build for a future
that has not arrived".

## osv-scanner runs in CI, and outside qlty

It is the one plugin deliberately absent from `.qlty/qlty.toml`, and the reason
is unchanged from the old record: it reaches the network on every run, and a
local `qlty check` that stalls offline is a tool people stop running.

`[[plugin]] triggers = ["build"]` looked like the answer. It is not, and this
was measured: with it set, the plugin is unreachable from `qlty check`
_everywhere_ - locally, under `CI=true`, under `GITHUB_ACTIONS=true`, under
`QLTY_TRIGGER=build`, filtered or unfiltered. `qlty check` has no `--trigger`
flag at all; only `qlty fmt` does. `triggers` is a Qlty Cloud concept, and
setting it here would disable the scanner rather than schedule it.

So it runs as its own CI job, pinned by digest rather than tag, since it is the
one step in the pipeline that runs somebody else's container. The lockfile scans
clean today.

## The gate

Two commands, both failing the build.

`qlty check --all` covers the formatter and the five checks. It exits non-zero
on any issue by default; `--no-fail` is the flag that would make it advisory
again, and it is not used.

`bin/qlty-smells-gate` covers duplication and complexity, because nothing in
qlty will. `qlty smells` exits 0 whether it finds twelve problems or none, and
smells reach none of the suppression machinery. The old record called this out
as real work that should be done for a reason; the reason is now the ruling, and
the work is a 300-line script with no dependencies.

It is **default-deny**. Every finding must match an entry in its `KEPT` list or
the gate fails, so a smell nobody has configured for - boolean logic, nesting,
parameter counts - fails without anyone having to remember it first.

The keys are chosen to survive the code moving underneath them:

- **Duplication** is keyed on qlty's `structural_hash`, derived from the syntax
  tree, so it survives reformatting and edits above it. Change what the
  duplicated code _does_ and the hash changes - which is the point, because the
  pair was kept on an argument about that code.
- A hash alone is **not enough**, and this changed the design rather than being
  reasoned about in advance. Pasting a third copy of a kept pair makes qlty
  report the same hash "in 3 locations", and the first version of the gate waved
  it through. Each entry now records how many copies were agreed to.
- **Complexity** carries no hash, so it is keyed on rule, file and the symbol
  qlty names, plus the count it was accepted at. Growth past that count fails.
  Equality would fail every innocent refactor; no bound at all would let
  `health.ts` go from 87 to 300 in silence, which is exactly the criticism the
  old blanket exclusion deserved.

Failures print in the shape `docs/principles.md` requires - what broke, why the
rule exists, the concrete edit - so the gate speaks the same language as the
invariant checks.

Nine findings are kept, each with its argument in the script: three duplications
(two lens pairs recorded in
`docs/decisions/2026-08-31-what-the-parallel-lens-build-duplicated.md`, one
inside a vendored component) and six complexity findings (`health.ts` at 87,
`KeyboardHelp` twice, `FleetPicker`, and two vendored grok components).

Both directions were demonstrated, not asserted: the gate exits 1 on a new
duplication, on a third copy of a kept one, on a kept finding grown past its
number, on a smell nobody had seen, and on an unformatted file; and 0 on the
tree as landed.

## What the numbers did

The old baseline is superseded. Taken on this branch, after formatting and after
the exclusions narrowed:

|                                         | Before this branch      | After                        |
| --------------------------------------- | ----------------------- | ---------------------------- |
| Paths hidden from all of qlty           | 6                       | 2                            |
| Findings `qlty smells` can see          | 4                       | 12                           |
| Findings judged and recorded            | 2, in `.qlty/qlty.toml` | 9, in `bin/qlty-smells-gate` |
| Duplication in `src/adapters/health.ts` | hidden                  | fixed                        |

The jump from 4 to 12 is not a regression. Eight of those findings existed the
whole time and were excluded from view; they are now visible and each carries a
written argument. One of them - a mass-106 duplication between `parseOverdue`
and `parseDrift`, the largest in the repository - turned out to be real and was
fixed the moment it could be seen.

## Trade-offs

**A second toolchain is now required, not optional.** The old record's
consolation was that nothing broke when qlty was missing. That is no longer
true: a contributor without qlty cannot format the tree and will fail CI. This
is the cost of the ruling, and it is a real one. `AGENTS.md` names the three
commands.

**`qlty smells --all` is noisier than it was.** Twelve findings rather than
four, because the exclusions stopped hiding eight of them. The command to run is
`bin/qlty-smells-gate`, which prints the verdict and names what is kept;
`qlty smells` is the raw report behind it.

**A kept finding with a number is a ratchet.** `health.ts` at 87 means a genuine
improvement that happens to add a branch fails the gate until someone edits the
number. That is the intended polarity - the alternative is the blanket exclusion
this change removed - but it will annoy somebody, and the fix is one line with a
sentence beside it.

**The CI cost is no longer zero.** Two jobs beside the test job. They run in
parallel, so wall-clock is bounded by the slowest rather than the sum, and the
qlty toolchain cache is keyed on `.qlty/qlty.toml`.
