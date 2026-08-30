# Contracts

Two shapes, and the boundary between them. Upstream owns one, the panel owns the
other, and `src/domain/` is the only thing that knows both.

## The document (the panel's own)

`src/types/document.ts`. The single shape `src/ui/` reads. Nothing in the UI may
reach past it, which is what makes the panel replaceable.

```ts
{
  version: number
  generatedAt: string            // ISO-8601, when the snapshot was generated
  workers: [{
    id: string
    project: string
    kind: "implement" | "review" | "research" | "chore"
    state: "running" | "idle" | "held" | "queued" | "finished" | "failed"
    since: string                // ISO-8601
  }]
  degraded: {
    reason: "stale-snapshot" | "read-failed"
    detail: string               // one line, written for the operator
    observedAt: string           // ISO-8601
  } | null
}
```

`degraded: null` means the document is a faithful, current picture. Anything
else means the panel is still showing something useful and owes the operator an
explanation of what is wrong with it - it never renders a blank page or an error
page in place of a fleet.

### Version history

| Version | Date | Change |
| --- | --- | --- |
| 1 | 2026-08-30 | First shape. Workers and their states, and one degradation reason at a time. |

Bump `DOCUMENT_VERSION` when a reader must notice the change, and add a row.

## The upstream snapshot

`src/adapters/contract.ts`. Owned by the fleet supervisor, not by us.

```ts
{
  schema: "fm-fleet-snapshot.v1"
  generatedAt: string
  workers: [{ id, project, kind, state, since }]
}
```

Upstream's state vocabulary is its own: `working`, `idle`, `held`, `queued`,
`done`, `failed`. The projection maps it onto the document's, which is why
upstream can rename `done` without a component changing.

## The pinned identifier

`SNAPSHOT_SCHEMA_ID` is `"fm-fleet-snapshot.v1"`, compared on every parse before
any other field is read.

A mismatch throws `ContractIdentifierError` naming the expected and the found
identifier, and the panel renders a refusal and nothing else. It never falls
back to an older document, because a changed contract means every field is
suspect: rendering a plausible-looking fleet from fields whose meaning has
shifted is the exact failure the pin exists to prevent.

This is distinct from `ContractParseError`, which a malformed snapshot throws.
The recovery differs on purpose: a half-written file will be whole a moment
later, so the runtime keeps showing last-known-good and marks it `read-failed`.
A changed schema will still be changed on the next read.

### Changing the pin

1. Update `SNAPSHOT_SCHEMA_ID` and the parser in `src/adapters/contract.ts`.
2. Update the projection in `src/domain/project.ts` if the vocabulary moved.
3. Add a fixture set for the new shape, and keep the old `mismatched` fixture -
   the refusal path must stay tested.
4. Add a row here.

| Identifier | Date | Note |
| --- | --- | --- |
| `fm-fleet-snapshot.v1` | 2026-08-30 | First pinned identifier. |
