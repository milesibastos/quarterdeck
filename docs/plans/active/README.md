# Active plans

Nothing is in flight. The document seam - see
`docs/plans/done/2026-08-30-document-seam.md`, and the skeleton before it - is
no longer frozen: it took its first bump since freezing, to version 3, in
`docs/decisions/2026-08-31-what-the-document-may-not-say.md`.

A plan here is one file: what is being built, why now, and a decision log
appended as choices are settled. When it lands, move the file to
`docs/plans/done/` rather than deleting it - that directory is the project's
memory of why things are the way they are, and the decision logs are the part
nobody can reconstruct from the code.

## What comes next

The fleet and deck parts of the document now come from a real fleet home, or
from fixtures when none is configured - see `docs/contract.md` and
`docs/quality.md`. Every lens has landed, and so has the pass that made them one
panel rather than three components sharing a page:

- The deck lens - `docs/plans/done/2026-08-30-deck-lens.md`.
- The shipshape lens - `docs/plans/done/2026-08-30-shipshape-lens.md`, and the
  two signals it was still missing -
  `docs/plans/done/2026-08-31-the-last-two-health-signals.md`.
- The write path - `docs/decisions/2026-08-30-answering-a-held-decision.md`.
- Choosing which fleet the panel is looking at, which settled where a per-viewer
  choice lives and is worth reading before adding a second one -
  `docs/decisions/2026-08-30-choosing-a-fleet.md`.
- The shell's proportions, which needed real lens content before they could be
  tuned - `docs/decisions/2026-08-31-the-fold-line.md` and the ruling that
  superseded it,
  `docs/decisions/2026-08-31-what-needs-you-owns-the-first-screen.md`, plus the
  theme that went with the first,
  `docs/decisions/2026-08-31-the-theme-follows-the-system.md`.

Two of the features version 4 froze a shape for have now been drawn: the landed
band, which is the first place this panel has ever said what the fleet finished
and which home finished it, and the disclosure bar under it, which names every
absence the document declares and which of three reasons it has -
`docs/decisions/2026-08-31-landed-work-and-the-disclosure-bar.md`. The bar is
worth reading before adding anything that can be partly shown: it is derived
from the document rather than written, on purpose.

The first feature built on top of that document has now landed too, and it is
the one that does not use it: the worker's terminal, read on demand and kept off
the first paint on purpose -
`docs/decisions/2026-08-31-the-worker-terminal.md`. It is worth reading before
adding anything else a card opens, because it settles where an on-demand read
lives and why it is not a field.

Two things the layout has kept a place for and deliberately not built: the
ready-to-merge card, which is the needs-you band's second group, and the thin
shipshape strip the wireframe draws in the masthead. Both are named in
`docs/decisions/2026-08-31-what-needs-you-owns-the-first-screen.md`.

What remains beyond those is in `docs/quality.md` under known gaps, and the
fleet lens's own lanes and filters, which nobody has asked for yet.
