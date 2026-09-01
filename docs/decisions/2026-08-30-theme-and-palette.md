# Theme through semantic tokens over a palette layer

Date: 2026-08-30
Status: accepted

## Context

The palette is the product's existing look and is not up for redesign. shadcn/ui
themes through CSS variables. The panel must work in light and dark, and must
not fetch a font at runtime.

## Decision

Three layers in `src/app/globals.css`, and components only ever touch the third:

1. `--qd-*` - the palette. Raw colour, no meaning.
2. `:root` and, originally, `.dark` - semantic tokens pointing at palette
   entries. See the superseded note below: `.dark` is gone, replaced by a
   second `:root` block keyed on `prefers-color-scheme`.
3. `@theme inline` - exposes them to Tailwind.

A component writes `bg-primary text-primary-foreground`, never a palette value.
Dark is the same product in ink and paper: surfaces become ink, text becomes
paper, and accents step one stop lighter because the surface got darker - not
because dark mode gets its own hues.

Chango, Jost and JetBrains Mono are committed as latin woff2 subsets under
`src/ui/fonts/` and loaded with `next/font/local`. See the superseded note
below: Chango and Jost are gone, and `src/ui/fonts/` holds one family.

**Superseded on 2026-09-01, in its values but not its mechanism.** The three
layers, the palette hop and the computed OKLCH all still hold and are what the
repaint was carried out through. What changed is everything they carry: the
ink-and-paper ramp became brainless's neutrals, the display face and the sans
were retired so `src/ui/fonts/` holds one family, and `--radius` went to zero.
See `docs/decisions/2026-09-01-the-brainless-palette-and-one-mono-face.md`.

## Trade-offs

**OKLCH values are computed, not eyeballed.** Each was converted from the source
hex with the OKLab matrices, and the hex is kept in a comment beside it so the
conversion stays auditable. Hand-guessing an OKLCH value is a coin flip per
token, and thirty-four coin flips is a different palette.

**A palette layer, rather than semantic tokens holding literal colours.** It
means two hops to find a colour. It also means the light and dark blocks read as
a mapping - "card is white, or ink-700 in the dark" - which is the thing a
reviewer actually needs to check, and it makes a palette change one edit.

**Dark is class-only.** ~~`.dark` on the root element, per shadcn's structure.
It does not follow the operator's system preference, because doing that without
an inline script means either duplicating every dark token inside a
`prefers-color-scheme` block - two copies that will drift - or shipping an
inline script that weakens the Content-Security-Policy invariant 7 depends on.
Neither is worth it for a skeleton with no theme switcher.~~

**Superseded on 2026-08-31**, by dropping the class rather than adding a second
copy of the mapping beside it: both objections above assumed `.dark` stays, and
neither survives it going. See
`docs/decisions/2026-08-31-the-theme-follows-the-system.md`. Everything else in
this decision - the three layers, the palette hop, the computed OKLCH values,
`next/font/local` - still stands.

**`next/font/local`, not `next/font/google`.** Next's Google font loader
self-hosts at build time and would satisfy the runtime rule. It would also make
a clean clone's build depend on a font service being up, and it puts the font
files somewhere nobody reviews. Committing the subsets with their OFL text makes
the dependency visible, and the check that enforces invariant 7 can simply ban
the import.
