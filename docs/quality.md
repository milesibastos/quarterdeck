# Quality

A grade per area, and where the gaps are. Written to be honest rather than
flattering: an area marked green is one somebody can build on without checking.

Last reviewed: 2026-08-30, at the end of the skeleton task.

| Area | Grade | Where it stands |
| --- | --- | --- |
| Layer boundaries | Green | All seven invariants checked in `npm test`, each with a planted violation proving the check works. |
| The document contract | Green | Pinned, parsed strictly, refusal tested end to end through the built server. |
| The refresh loop | Green | Coalescing, timeout, last-known-good and the signal are tested; scroll preservation demonstrated in a browser, not asserted. |
| Fixtures | Green | Every degraded state the panel can reach has a fixture, and both the suite and the dev server run from them. |
| Theme | Green | Semantic tokens over a palette layer, light and dark, fonts vendored. Not yet exercised by anything more complex than a list row. |
| Security baseline | Amber | Host, Origin, CSP and the acting guard are tested. The session secret is minted and required but never handed to a client, because nothing acts yet - the round trip is untested by construction. Action-request identity and replay rejection are similarly untested: `Intent.requestId` exists as a type only, and no wired path reads it. |
| `adapters/health.ts` | Amber | Returns `unknown` for every field. Correct for now, but the degradation behaviour that matters - not throwing when a path moves - has nothing to exercise it yet. |
| The write path | Red | `intent.ts` holds the type and the marker and writes nothing. `submitIntent` refuses. Deliberate: out of scope for the skeleton. Idempotency is deferred along with it - see `docs/decisions/2026-08-30-security-baseline.md` - and is not enforced today. |
| The deck and shipshape lenses | Red | Not started. Out of scope for the skeleton. |
| Reading a real fleet | Red | Not started. The adapter's only wired source is the fixture loader. |

## Known gaps

- **Nothing reads a real fleet.** The injected-source position in
  `contract.ts` exists and has exactly one implementation. Adding a real source
  is where the `health.ts` quarantine will first be tested for real.
- **The UI is one list row.** The theme, the layering and the refresh loop are
  proven, but none of them has been asked to carry a lane layout, a lifecycle
  rail or an embedded terminal.
- **No accessibility pass.** Semantic elements and a `role="status"` on the
  degradation banner are as far as it goes. Keyboard traversal and contrast
  ratios across all four status tokens have not been checked.
- **The dark theme is class-only.** It has no switcher and does not follow the
  operator's system preference. See
  `docs/decisions/2026-08-30-theme-and-palette.md`.
