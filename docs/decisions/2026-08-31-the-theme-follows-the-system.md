# The theme follows the operator's system setting

Date: 2026-08-31
Status: accepted. Supersedes the "Dark is class-only" trade-off in
`docs/decisions/2026-08-30-theme-and-palette.md`.

## Context

The dark theme was a `.dark` class on the root element, per shadcn's structure.
Nothing ever put that class there, so no build of this panel had ever rendered
its dark theme: an operator whose machine is set to dark got the paper theme,
and the whole second half of the token layer was dead code that still had to be
maintained.

The original decision named two ways to fix it and rejected both. Either
duplicate every dark token inside a `prefers-color-scheme` block - two copies
that will drift - or ship an inline script that reads the setting and sets the
class, which weakens the Content-Security-Policy invariant 7 depends on.

Both objections are real. Both assumed the class stays.

## Decision

Drop the class. The dark mapping moves from `.dark { ... }` into
`@media (prefers-color-scheme: dark) { :root { ... } }`, unchanged, and the
`dark:` variant is redefined to ask the same question:

```css
@custom-variant dark (@media (prefers-color-scheme: dark));
```

There is one copy of the mapping, not two, so there is nothing to drift. There
is no script, so there is nothing to run before the first paint and nothing to
flash. The Content-Security-Policy is untouched.

There is no switcher, and there is nothing to switch: the operator's setting is
the input, and a panel that argued with it would be asserting a preference it
has no way to know.

The `dark:` variant matters more than it looks. Three vendored shadcn
components - `badge.tsx`, `button.tsx` - carry `dark:` utilities. Left keyed on
a class that no longer exists, they would have compiled to selectors that never
match, and dark mode would have drawn light-variant component chrome over dark
tokens. Both the tokens and the utilities now resolve through the same media
query, so they cannot disagree about which theme is on.

## Three tokens moved, because the dark theme was never on screen

Switching it on is the first time anybody has looked at it. Measured against
`--card` in the built panel, three of its values were below WCAG AA for body
text, so each was re-pointed at a different stop of the same palette - no new
colour was invented, and the light theme is untouched:

| Token                | Was        | Is          | Ratio on `--card`         |
| -------------------- | ---------- | ----------- | ------------------------- |
| `--muted-foreground` | `ink-300`  | `paper-300` | 3.70 to 8.64              |
| `--secondary`        | `navy-300` | `navy-100`  | 3.77 to 12.46 (as a chip) |
| `--destructive`      | `rust-400` | `rust-300`  | 3.24 to 4.49              |

`--muted-foreground` carries most of the panel's secondary prose, which made it
the one that mattered. `--secondary` was the odd chip out: `online` and `info`
are already pale backgrounds carrying dark text in this theme, and `navy-300`
was not. `--destructive` now points at the same stop as `--danger`, which is the
same thing said twice and is now said the same way.

The measured ratios are in `docs/quality.md`. Two of them were below AA when
this was written and both were closed by the 2026-09-01 repaint, which replaced
the palette these tokens point at.

## Trade-offs

**Dark's muted text was brighter than the mapping first specified**, because
the warm ramp had no stop between the two the mapping wanted, so "muted" was a
quieter distinction in dark than in light. The 2026-09-01 repaint replaced that
ramp with a neutral one that has the stops: the five text ranks now step evenly
in both themes. See `docs/decisions/2026-09-01-the-brainless-palette-and-one-mono-face.md`.

**No switcher, so an operator cannot disagree with their machine.** Somebody who
wants the panel light on a dark desktop cannot have it. Adding that means a
second per-viewer preference, which this project has settled the shape of once
already - see `docs/decisions/2026-08-30-choosing-a-fleet.md` - and it should be
built the same way if it is ever wanted, not with a class and a script.

**`color-scheme` is declared in both blocks.** It is what makes the browser's
own scrollbars, form controls and canvas match, and it is the reason the very
first paint is already the right colour rather than white.

## See also

- `src/app/globals.css` - the two blocks.
- `tests/shell.test.ts` - what the served stylesheet is asserted to say.
- Verified in a browser under an emulated `prefers-color-scheme` in both
  directions: the body's background and foreground swap, and
  `getComputedStyle(document.documentElement).colorScheme` follows.
