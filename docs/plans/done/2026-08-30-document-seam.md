# The document seam

2026-08-30. Landed.

## What was built

The seam that lets the rest of quarterdeck be built by several workers at once:
the complete document type covering all three lenses, fixtures reaching every
state it can be in, and empty placeholder lens components mounted in the shell.

No behaviour. No adapter for a real fleet, no lens content, no write path -
those are the four workers who start next, and the point of this task was that
they can each work without reading each other's code.

- `src/types/document.ts` - the whole shape. Envelope with a status per lens;
  fleet, deck and health parts.
- `src/adapters/contract.ts` - reshaped to the verified upstream snapshot,
  identifier unchanged. Carries fleet and deck.
- `src/adapters/health.ts` - now reads a health file, and degrades rather than
  throwing when it cannot.
- `src/domain/project.ts` - two readings in, one document out.
- `src/ui/{fleet,deck,shipshape}/` - one placeholder each, plus `shell.tsx` and
  the shared `lens-frame.tsx`.
- `fixtures/` - ten sets, two files each.
- `tests/document.test.ts` - walks every set and asserts the document.

## Decision log

**The upstream shape was corrected mid-task.** The brief specified a two-pass
lifecycle read - a cheap fleet-wide call giving coarse stages, a per-worker call
sharpening each to its exact pipeline step - and asked the document to carry
"coarse only, not sharpened yet". Verified against a live fleet, that premise
was false: upstream's single call returns each worker fully reconciled. The
distinction was removed from the document, the fixtures and the docs before
anything was built on it, and the verified upstream shape replaced the
provisional one under the same pinned identifier.

**Per-lens degradation, no document-wide flag.** The three lenses do not share a
reliability promise: fleet and deck parse or refuse, health can simply be gone.
See `docs/decisions/2026-08-30-the-document-seam.md`.

**A second fixture file per set.** Health is not in the snapshot, so a fixture
set is `snapshot.json` plus `health.json`. That is what makes "health dark while
fleet and deck are fine" - and its inverse - expressible at all, and it gives the
quarantined module something to actually degrade on.

**Four value sets are assumptions, written down rather than hidden.** Upstream's
state and priority vocabularies, the snapshot's `generated_at`, and a pull
request's checks. Each is pinned by one file and one fixture directory, and each
is listed at the end of `docs/contract.md` so the worker who wires a real source
finds a list rather than a surprise.

**`checks` kept, `sharpened` dropped.** Both were fields nothing sets today. The
difference is that `checks` has a definite future writer and reader, and
`sharpened` described a read that does not exist. Reasoning in the decision
record; it is the distinction most likely to be re-litigated.

**No `stoppedIn`.** The brief wanted a halted worker to name the stage it
stopped in. Upstream has no such field, and anything the document could put
there would be derived from the prose `detail` that `step` is already read from.
`stage` plus `step` plus `detail` carries the intent without a field that drifts.

**The skeleton's fleet panel was deleted, not migrated.** It rendered a shape
that no longer exists. Leaving it would have handed the fleet-lens worker two
places to work in and an old vocabulary to reconcile first.
