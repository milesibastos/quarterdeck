# Quality

A grade per area, and where the gaps are. Written to be honest rather than
flattering: an area marked green is one somebody can build on without checking.

Last reviewed: 2026-08-30, at the end of the document-seam task.

| Area | Grade | Where it stands |
| --- | --- | --- |
| Layer boundaries | Green | All seven invariants checked in `npm test`, each with a planted violation proving the check works. |
| The document contract | Green | All three lenses, a status per lens, pinned and parsed strictly. `tests/document.test.ts` walks every fixture set and asserts the document it produces; the refusal is tested end to end through the built server. Four value sets in the upstream snapshot are assumptions rather than verified - listed at the end of `docs/contract.md`. |
| The refresh loop | Green | Coalescing, timeout, last-known-good and the signal are tested; scroll preservation demonstrated in a browser, not asserted. |
| Fixtures | Green | Ten sets, two files each. Every state the document can reach has one, including each lens dark on its own, and both the suite and the dev server run from them. |
| Theme | Green | Semantic tokens over a palette layer, light and dark, fonts vendored. Not yet exercised by anything more complex than a lens frame. |
| Security baseline | Amber | Host, Origin, CSP and the acting guard are tested. The session secret is minted and required but never handed to a client, because nothing acts yet - the round trip is untested by construction. Action-request identity and replay rejection are similarly untested: `Intent.requestId` exists as a type only, and no wired path reads it. |
| `adapters/health.ts` | Amber | Now reads a health file from a directory only it may name, and degrades to an unreadable reading on any failure - exercised by the `health-dark` set, which has no file at all. Still amber because what it reads is a fixture the panel itself defines; nothing has yet pointed it at a location that can move under it. |
| The write path | Red | `intent.ts` holds the type and the marker and writes nothing. `submitIntent` refuses. Deliberate: out of scope for the skeleton. Idempotency is deferred along with it - see `docs/decisions/2026-08-30-security-baseline.md` - and is not enforced today. |
| The deck and shipshape lenses | Red | Placeholders mounted in the shell, each in its own directory, each handed its part of the document. Nothing is drawn yet - deliberately: the lens content is the next workers' job, and the seam they build against is what this task froze. |
| The fleet lens | Red | As above. The worker-card list from the skeleton was removed rather than half-migrated to the new shape. |
| Reading a real fleet | Red | Not started. The adapter's only wired source is the fixture loader. |

## Known gaps

- **Nothing reads a real fleet.** The injected-source position in
  `contract.ts` exists and has exactly one implementation. Adding a real source
  is where the `health.ts` quarantine will first be tested for real.
- **The UI is three placeholders.** The theme, the layering and the refresh loop
  are proven, but none of them has been asked to carry a lane layout, a
  lifecycle rail or an embedded terminal. The shell places the three lenses and
  stops there: proportions and the fold line need real content before they can
  be tuned.
- **`ChecksState` is always `unknown`.** Upstream's snapshot carries a pull
  request's address but nothing about its checks. The field is in the document
  on purpose; filling it means reading the forge. See
  `docs/decisions/2026-08-30-the-document-seam.md`.
- **No accessibility pass.** Semantic elements and a `role="status"` on each
  lens's status line, in `lens-frame.tsx`, are as far as it goes. Keyboard
  traversal and contrast ratios across all four status tokens have not been
  checked.
- **The dark theme is class-only.** It has no switcher and does not follow the
  operator's system preference. See
  `docs/decisions/2026-08-30-theme-and-palette.md`.
