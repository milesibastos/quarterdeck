# A blocker is an identity, so the deck lens is handed the fleet

2026-08-30. Settled while building the deck lens.

## The decision

`DeckLens` takes the fleet's `Worker[]` alongside its own `DeckItem[]`, from the
shell, and uses it for one thing: turning the bare identities in
`DeckItem.blocked.ids` into something a reader can act on, and deciding whether
each one is still in the way.

## Why

The document says an item is blocked by `wi-cordage-401` and nothing else. That
identity is not in the deck: work that has started has left the backlog, and
`done` records are dropped from it entirely. So within its own slice the lens
can do exactly two things - repeat the id back, or claim a blocker it cannot see
is finished.

Both are wrong. Repeating the id says nothing about whether anything is actually
in the way, and an operator reading a blocked row wants the second question
answered first. Guessing from absence - "not in the deck, so it must be done" -
is the worse of the two: the fleet's own `blocked` and `failed` workers are
absent from the deck for the same reason a landed one is, so the guess clears
rows that are genuinely stuck.

The fleet is in the document. Reading it here costs the deck nothing that
matters: `src/ui/` may see the whole document, invariant 6 is about not reaching
*past* it, and no adapter, path or fetch enters the lens. What it buys is the
one thing the row is for - `wi-cordage-401 landed; no longer blocking` instead
of a badge that stays lit forever.

## The rule the lens applies

Per blocker id, in `src/ui/deck/deck-groups.ts`:

| Where the id is found | What the lens says |
| --- | --- |
| In the deck | Still blocking. Names it by its title and deck state. |
| In the fleet, `landed` | Cleared. The item leaves the blocked pile and the row says what landed. |
| In the fleet, any other stage | Still blocking. Names its project and stage - `failed` blocks as surely as `working` does. |
| In neither | Still blocking. Names the bare id, and claims nothing else. |

`landed` is the only stage that means done, and an unknown blocker is not a
cleared one. Both directions of that rule are tested through the built server:
the `healthy` set has a blocker that landed, and `deck-only` - the same deck with
no fleet beside it - has the same item still blocked because nothing can settle
it.

## What it costs

The deck lens now knows the fleet exists, which the other two lenses do not.
If the fleet lens goes stale or dark while the deck stays current, the deck is
reading a stale directory - it will name a blocker's stage as of the last good
fleet read. That is survivable and deliberate: the alternative is naming nothing
at all, and the row still carries the blocker's identity, which does not go
stale.

The cleaner fix lives upstream, not here: if `blocked.ids` carried each
blocker's title and whether it had finished, the deck would need no directory.
That is a change to the pinned contract and the document type, which is the real
fleet source worker's territory, not a lens's.
