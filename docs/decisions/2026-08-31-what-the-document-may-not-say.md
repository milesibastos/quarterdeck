# What the document may not say

**2026-08-31.** Document version 3. Three fields moved together, and the same
argument settled all three: the document may carry what upstream published and
it may carry an absence, but it may not carry a value nobody established.

## What was decided

**`unknown` gets a stage of its own, `unseen`, and it is not a halted stage.**
Upstream reports `unknown` when nothing answered for a worker - the worktree was
torn down, or no source of current state replied. It used to land on `waiting`,
which is a claim: stopped, and stopped on something outside the fleet. Nobody
established that. `unseen` asserts no position on the track and no reason for
stopping, and the rail draws it unlit.

It sits in `Stage` as its own group rather than as a fifth `HaltedStage`. The
type is read by people folding stages into "running" and "stopped", and a fifth
halted stage would be silently counted as stopped by every one of them.

**`DeckItem` gains `project` and `kind`, both nullable.** Upstream publishes
`repo` and `kind` per backlog record; they were dropped at our own boundary. A
worker's equivalents are not nullable, because a worker is dispatched with a
kind and works somewhere. A backlog row is written by hand, and across two live
fleets more rows name neither than name both.

**`DeckItem.since` becomes nullable.** A row with no start date used to be
stamped with the moment upstream happened to look, which reads as an age of
zero: work queued a month ago and work queued this minute drawn the same.

## Why not the alternatives

**A `lastActiveStage`, so an unseen worker could say where it was.** That is a
different gap, still open, and it is about halted workers. An unseen worker's
last position is exactly what upstream could not read, so the field would be
null for every one of them.

**Defaulting a deck row's kind to `build`, the way a worker's does.** It would
have kept the type simpler and put research work under the wrong word on the
rows that most need telling apart. The two rules differ only in what absence
means, and they share one function so the reading of the field cannot drift.

**Dropping an undated row off the deck.** The row is real work that is really
queued. Its date is what is missing, not the row.

## What it cost

`since` is part of the answer record's identity, and the wire field is a string.
An absent start date travels as the empty string - unambiguous, because
upstream's prose reader never yields an empty `since` and the digest is
length-prefixed. This is better than what it replaced rather than a compromise:
the moment upstream looked changed on every read, so an answer to an undated
record minted a fresh request id each pass and had, in practice, no replay
protection at all. The empty string is stable.

Three nullable fields is three more places a lens has to say what an absence
looks like on screen. The deck row omits a project or a kind it does not have,
and writes "no start date" in words. Nothing renders a placeholder value: a
dash where a project should be is a different lie from the one this removed.

## The rule this leaves

Add a field to the document when a lens needs it, and make it nullable when
upstream's answer can honestly be "nobody said". The alternative - a sentinel,
or the read's own moment, or the most common value - reads as data and gets
believed. See `docs/contract.md` for the shapes and the version history.
