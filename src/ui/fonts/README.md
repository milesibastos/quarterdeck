# Vendored fonts

This file is committed on purpose. Invariant 7 forbids network egress from the
browser at runtime, so nothing may be fetched from a font service while the
panel runs. The latin subset below is served from this repository through
`next/font/local` (see `src/ui/fonts/fonts.ts`).

| File                            | Family         | Weights            | Copyright                                                                                        |
| ------------------------------- | -------------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| `jetbrains-mono-variable.woff2` | JetBrains Mono | 100–800 (variable) | Copyright 2020 The JetBrains Mono Project Authors (<https://github.com/JetBrains/JetBrainsMono>) |

It is licensed under the SIL Open Font License, Version 1.1, whose full text is
in `OFL.txt`.

There is one family here and that is the point: the panel is drawn in a
terminal grammar, and a second face is a second voice. A Chango display face
and a Jost sans were removed on 2026-09-01 - see
`docs/decisions/2026-09-01-the-brainless-palette-and-one-mono-face.md` before
adding another.

To refresh the subset, take the `/* latin */` `src: url(...)` from the family's
`https://fonts.googleapis.com/css2` response and replace the file in place.
