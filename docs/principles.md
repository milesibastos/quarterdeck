# Principles

The mechanical rules a cleanup pass enforces. Anything here that can be checked
by a machine is; the rest is written down so a reviewer has something to point
at rather than a preference to argue.

## Nothing real in the repository

This repository is public and the tool reads a private fleet. No real project
name, machine path, home directory, operator name or task identifier may enter
it, in code, fixtures, comments, commit messages or documentation.

All test material is synthetic, and has been since the first commit, so that
nobody ever has to decide - later, and in a hurry - whether a particular sample
is safe to publish. `npm test` greps every tracked file, plus every uncommitted
file that is not gitignored, for machine paths and task identifiers and fails
on a match.

## Parse at the boundary, and only at the boundary

There are three boundaries: the snapshot parse, the config read, and the HTTP
request. Validate there, exhaustively, and nowhere else. Code downstream of a
boundary trusts what the boundary handed it - re-checking a value that was
already checked adds a branch nobody can reach and a test nobody can write.

Never guess at a data shape. Parse it.

## Degrade, do not disappear

A panel that shows an error page where a fleet was is less useful than one
showing a stale fleet and saying so. Keep last-known-good, label it, and say
what is wrong with it in one line an operator can act on.

The exception is a contract this build does not understand, where every field is
suspect. That one refuses outright.

## Failure messages hand the reader the correction

These are read by agents, not decoded by people. Every violation states what
broke, why the rule exists, and the concrete edit that fixes it, in this shape:

    x forward-dependency  src/domain/rails.ts:14
      domain imported from adapters. Dependencies point forward only.
      The projection must stay pure so it can be tested without a fleet.
      Move the read into adapters/contract.ts, add the value to the document
      type in types/document.ts, and read it from there.
      See docs/ARCHITECTURE.md - layers.

One formatter produces it - `tests/lib/violation.ts` - so a new check cannot
invent a new format.

## Prefer a shared helper over a new one

Before adding a formatter, a guard, or a fetch wrapper, look for the one that
exists. Two implementations of the same idea drift, and the drift is invisible
until the day they disagree.

## Do not build for a future that has not arrived

No error handling for scenarios that cannot happen. No abstraction with one
implementation and no second caller in sight. No configuration nobody sets. A
skeleton that is honest about what it does not do yet is easier to grow than one
padded with machinery for a shape nobody has seen.

The counter-example is the security baseline, which is in place before the write
path exists - on purpose, because retrofitting a guard means shipping a build
where the acting route exists and the guard does not.

## Comments say why

The code says what. A comment that restates the line above it is noise that goes
stale. A comment naming the reason a rule exists, or the failure a line prevents,
is the only thing a future reader cannot reconstruct.
