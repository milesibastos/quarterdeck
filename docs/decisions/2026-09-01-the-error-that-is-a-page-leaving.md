# The error that is a page leaving

2026-09-01

A clean start of the panel printed this, between the watchers registering and
the line saying the panel was up:

```text
[quarterdeck] info watching for fleet changes {"watchDir": ".../state"}
[quarterdeck] info watching for fleet changes {"watchDir": ".../data"}
⨯ Error: The destination stream closed early.
    at ignore-listed frames { digest: '2330846373' }
quarterdeck listening on http://127.0.0.1:45229
```

The panel then worked. Nothing the operator could see had failed, and they had
been told something had.

## What produces it

Next answers a page's `router.refresh()` with the flight payload alone - no
HTML - and builds it with React's `renderToPipeableStream`, piped into a
`PassThrough` it hands to the response. React listens on the far end of that
pipe: if it closes while the render still has work outstanding, React reports
`The destination stream closed early.` and Next prints it as a red `⨯ Error`
with a digest.

The full-page render does not do this, and that is the whole of the difference.
Next passes the request's abort signal to that one, so a client going away
aborts the render first and React's close handler finds a request already
stopped and returns. The flight-only render is built with `signal: void 0` -
Next's own code, not a setting - so nothing aborts it, and the closed pipe is
the first thing React hears about. Measured, on this tree:

- A full-page `GET /` whose socket is destroyed 1.5s into a 4.5s read: nothing
  printed.
- A change-signal stream killed mid-connection: nothing printed.
- The launcher's own readiness `fetch`: nothing printed, and it cannot - the
  page has no `Suspense`, so the flight render is finished before a single byte
  of the response is flushed.
- Twenty-five starts with no browser anywhere near the port - ten warm, ten
  cold, five from `rm -rf .next` through a full build: all clean.
- A page asking for a refresh and going away 500ms into a 4s read: printed,
  every time.

So the message means one thing on this panel: **a page stopped listening while
the server was still building the refresh it had asked for.** A reload, a closed
tab, a navigation, a restarted panel - `LiveRefresh` reconnects on its own, and
the fleet home it reconnects to is a fleet that keeps moving, so refreshes are
in flight most of the time and any of those endings lands in one.

## What it was not

The previous investigation - `docs/decisions/2026-09-01-stopping-the-panel.md` -
recorded this same sentence at shutdown and named the cause correctly: a client
going away mid-render. The reasonable suspicion after that fix landed was that
`src/instrumentation.ts` had moved the error to boot rather than removed it,
because the two arrived together and the build's own import trace names that
file. It had not. The register adds two signal handlers and imports modules that
declare functions; nothing in it touches a stream, and twenty-five client-less
starts print nothing. The counterfactual says the same from the other side: five
client-less starts on `1835cc8`, the commit before #37, on this machine against
the same home - also clean. Neither build prints without a client. What
discriminates is not the commit but whether a page is listening.

Nor is it the build. `npm start` builds when the tree has moved, and the
transcript that carried the error had built first while the one that did not had
not - which made the build the obvious masking condition. It is not: five starts
from `rm -rf .next` through a full build, with no browser anywhere near the
port, printed nothing.

What the boot occurrence had instead was a client: a browser tab left open on
that URL from before, whose `LiveRefresh` reconnects by itself and whose
`router.refresh()` is exactly the render this comes from. That is a sufficient
explanation and it is the only client class that can produce the message - but
it was not reproduced at boot here, and is recorded as sufficient rather than
confirmed.

## What was changed

`explainPagesThatLeave` in `src/providers/logger.ts` claims that one message and
says what it means:

```text
[quarterdeck] info a page stopped listening while the panel was still rendering its refresh; nothing was lost
```

Everything else `console.error` is given goes through untouched. The claim is
made on the exact message and on nothing else - not on a digest, which is a hash
of the sanitised stack and differs between builds, and not on a request shape,
which is not in the console's hands.

It is claimed rather than tolerated because an operator cannot be asked to learn
which red errors to ignore. A panel that prints one on a healthy start has spent
the only signal it has, and the next real fault arrives in a terminal where the
operator has already been trained to look past that colour.

## Why the console and not something upstream

The render is Next's own; the panel never holds that stream and cannot abort it
when the request aborts. Next's `onRequestError` hook is told about the error -
a throwaway one identified the request behind it, as `/?_rsc=…` with
`renderSource: react-server-components-payload`, which is how the paragraphs
above are able to name it - but being told is all such a hook can do. It cannot
stop Next printing, and Next offers no setting that can, so nothing was kept
there: a hook that only watches is a second place to maintain saying what the
one line already says.

So the last place the panel owns is the console, and the console is already
`src/providers/`'s alone: nothing outside that directory may call it, which is
checked. The wrapper is installed from `register()` for the same reason the stop
path is - it is the one hook that runs once per server process, before any
request.

## What is checked

`tests/refresh.test.ts`, in "a page that leaves while its refresh is still
rendering". It stands up a fleet home whose snapshot command sleeps, waits for
the change signal so the refresh is a real read rather than the cache, asks for
that refresh the way a page does, and destroys the socket half a second in. It
then asserts the panel said what happened, and that React's sentence is not on
standard error. It fails on the code as it was, on the first of those two.

The request it sends is the interesting part of the file: `RSC: 1` plus the
router state tree a page sends when it is refetching itself. Next answers an
`_rsc` hash it did not mint with a 307 to the one it did, so the test follows
that redirect rather than hard-coding a hash that belongs to one build.
