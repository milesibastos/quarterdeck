# Every fixture is invented, and a test enforces it

Date: 2026-08-30
Status: accepted

## Context

The repository is public. The tool reads a private fleet: real project names,
machine paths, task identifiers and worker output.

## Decision

All test material is synthetic from the first commit. Invented project names
(`tidewater`, `lamplight`, `saltmarsh`), invented worker ids, paths under a fake
root. `npm test` greps the tracked files for home directories, machine-local
temporary paths, worktree pool paths and fleet task identifiers, and fails on a
match.

Which fixture set the panel reads is a config value, not a code change, so the
same fixtures drive the suite and the development server.

## Why a test rather than a rule

The rule is easy to state and easy to keep - right up to the day somebody is
debugging a real fleet and pastes a real snapshot in to reproduce something.
That is exactly the moment nobody wants to stop and think about publication. A
check that runs on every test makes the answer automatic.

Being synthetic from the first commit matters more than being synthetic
eventually: once one real sample is in the history, it is in the history.

## Trade-offs

**Fixtures are dated in 2099.** A committed fixture with a past timestamp goes
stale within a minute of being written, which would make the healthy fixture
render a staleness banner and the acceptance tests rot with the calendar. Dating
them ahead keeps them permanently fresh. The cost is that ages render as "just
now", which is why `QUARTERDECK_NOW` exists: tests that care about staleness pin
the clock instead of racing it.

**Third-party vendored files are exempt from the leak grep.**
`.agents/skills/` is refreshed wholesale by `npx skills add` and documents
generic tool locations like `~/.codex/`, which name nobody's machine. Rewriting
upstream's documentation to satisfy our guard would only fail again on the next
refresh. The exemption is a directory, named in `tests/leak-guard.test.ts` with
its reason.
