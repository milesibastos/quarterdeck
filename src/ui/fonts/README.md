# Vendored fonts

These files are committed on purpose. Invariant 7 forbids network egress from
the browser at runtime, so nothing may be fetched from a font service while the
panel runs. The latin subsets below are served from this repository through
`next/font/local` (see `src/ui/fonts/fonts.ts`).

| File                            | Family         | Weights            | Copyright                                                                                        |
| ------------------------------- | -------------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| `chango-400.woff2`              | Chango         | 400                | Copyright (c) 2011 Fontstage (<info@fontstage.com>), with Reserved Font Names, 'Chango'          |
| `jost-variable.woff2`           | Jost           | 100–900 (variable) | Copyright 2020 The Jost Project Authors (<https://github.com/indestructible-type>)               |
| `jetbrains-mono-variable.woff2` | JetBrains Mono | 100–800 (variable) | Copyright 2020 The JetBrains Mono Project Authors (<https://github.com/JetBrains/JetBrainsMono>) |

All three are licensed under the SIL Open Font License, Version 1.1, whose full
text is in `OFL.txt`. The copyright lines differ per family and are listed above.

To refresh a subset, take the `/* latin */` `src: url(...)` from the family's
`https://fonts.googleapis.com/css2` response and replace the file in place.
