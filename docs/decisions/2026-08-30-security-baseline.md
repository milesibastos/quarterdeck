# The security baseline ships before the write path

Date: 2026-08-30
Status: accepted

## Context

The panel reads today and will act on a live fleet later. It binds to loopback
on a machine the operator also browses the web from.

## Decision

From the first commit: loopback binding only; `Host` and `Origin` validated on
every request; a session secret minted at start and required by everything under
`/api/act`; no cross-origin sharing headers; a Content-Security-Policy in which
every directive resolves to `'self'`; and an `Intent` type carrying a
`requestId` so a retry cannot act twice.

## Why now, when nothing acts

This is the one place the "do not build for a future that has not arrived"
principle is deliberately set aside, so the reason is worth stating. The
alternative is adding the guard alongside the first acting endpoint, which means
there is a commit - and possibly a release - in which the endpoint exists and
the guard does not. Putting the guard in front of a route that returns 501 costs
almost nothing and removes that window entirely.

**Loopback is not a boundary.** The `Host` and `Origin` checks are not about
other machines; they are about the operator's own browser. Any page on the web
can point a form or an image at `http://127.0.0.1:45818`. Binding to loopback
does nothing about that, and a panel that will later accept a decision must
refuse a request it did not originate.

## Trade-offs

**The session secret is never handed to the browser.** So the acting round trip
cannot be tested end to end - the tests prove that a request without the secret,
and one with the wrong secret, are both refused. Getting the secret to the page
is part of the write path.

**`script-src` allows `'unsafe-inline'`.** Next inlines its hydration data and
bootstrap script into the document, and a nonce would need per-request header
generation from middleware. The directive that invariant 7 actually rests on is
that no directive names a remote source, and that one is strict and tested.

**The host check runs in the edge-runtime proxy; the session check does not.**
`isValidSession` needs `node:crypto` for a constant-time compare, which the edge
runtime does not have. Rather than turn on Node-runtime middleware, the acting
guard lives in the acting route itself, which runs in Node. The cost is that the
two halves of the baseline live in two files; both are named in
`docs/ARCHITECTURE.md`.

## Forward obligation: idempotency ships with the first acting endpoint

`Intent.requestId` exists today only as a type - no wired path reads it, and
`docs/quality.md` records that as untested by construction, the same way the
session-secret round trip is. That is acceptable while `/api/act` unconditionally
returns 501: there is no action to replay yet.

It stops being acceptable the moment that changes. The change that makes
`/api/act` do anything other than return 501 must land request identity and
replay rejection in that same change, not after it - for the same reason this
baseline shipped ahead of the write path in the first place: an acting endpoint
must never ship ahead of the mechanism that stops it acting twice.
