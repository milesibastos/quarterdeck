# `src/app/` is the composition point

Date: 2026-08-30
Status: accepted
Supersedes nothing. Detail behind a judgement call in
`2026-08-30-layer-model.md`.

## Context

Invariant 6 says `src/ui/` imports only the document type and providers. A page
must read the fleet. Both cannot be true of the same file.

## Decision

Next's route files - `src/app/**` and `src/proxy.ts` - are a position outside
the six layers. They may import from every layer, and they are the only thing
that may. Components under `src/ui/` receive everything as props.

## Consequences

The rule that keeps this honest is that route files stay thin: read, translate,
hand to a component. `src/app/page.tsx` reads the document, turns a
`ContractIdentifierError` into plain props, and renders. That translation step
is what lets `src/ui/contract-refusal.tsx` display a contract failure without
importing anything from `src/adapters/`.

Nothing checks "thin". If a route file grows logic, that logic belongs in a
layer, and the only signal will be a reviewer noticing. This is the weakest
boundary in the design and it is named here so the next person knows to watch it.

A second consequence found during this task: no JSX may be constructed inside a
`try`. React builds elements after the block has been left, so the `catch` never
sees rendering errors - `page.tsx` does its reading and translating in a plain
async function and renders outside it. ESLint's `react-hooks/error-boundaries`
catches this, which is why `npm run lint` runs before the tests.
