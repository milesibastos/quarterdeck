# Stopping the panel

2026-09-01

An operator started a panel against a real fleet home, stopped it two minutes
later, got their shell prompt back - and then watched this print on top of the
prompt:

```text
fish: Job 1, 'QUARTERDECK_FLEET_HOME=…' terminated by signal SIGTERM (Polite quit request)

... took 2m11s
❯ ⨯ Error: The destination stream closed early.
    at ignore-listed frames {
  digest: '2330846373'
}
```

Two things are wrong in that transcript, and only one of them is the error.

## The panel did not stop

`tests/lib/server.ts` already states the standard: a child that does not exit on
SIGTERM "is a bug in the panel's stop path, and killing it quietly would hide it
for as long as the suite stayed green." That is exactly what had been happening.

Next's production shutdown asks the HTTP server to close and then waits for
every connection still on it to finish, because a request cut in half is worse
than a slow exit. The change signal - `src/app/api/events/route.ts` - is a
response that never finishes on its own: it is held open for as long as a page
is watching, which is the whole point of it. So the wait never ended. A panel
with one open tab did not exit on a polite quit request, and would have waited
for as long as the tab stayed open.

Measured, with a browser on the page: the server was still running and still
holding its port thirty seconds after the stop, and only went when the page
holding the stream did. Without the stream, it exited in under a second.

The two minutes in the report are incidental. `took 2m11s` is the shell timing
its own job - how long the operator happened to leave the panel running - not a
fuse. What decides whether this shows up is whether a page was watching when the
stop arrived, and the reproduction fires at any age, seconds included.

The launcher, meanwhile, went at once. It is the shell's job, so the prompt came
back on its death - while the panel it started was still running behind it.

That is the whole of the transcript. The error is not a shutdown error at all:
`The destination stream closed early.` is what React's Flight serializer says
whenever a client goes away while a render is still producing - a tab closed, a
navigation, a reload. It was landing on top of a prompt only because the panel
was still alive to print it after the shell had moved on, still serving a
browser whose `LiveRefresh` was still asking for renders. Reproduced on demand,
with no shutdown involved at all, by navigating away from the page while a
refresh was in flight.

## What was changed

**Whatever holds a connection open past a request closes itself on the stop.**
`src/runtime/shutdown.ts` is the register of those things; `src/instrumentation.ts`
puts it on the process's signals, which is the one place Next hands the panel
the process rather than a request. The handler is added to Next's, not
substituted for it: Next's is what drains the requests in flight, and this is
what lets that drain finish.

**A stopping panel refuses a new change-signal stream.** `EventSource`
reconnects on its own - that is what lets a restarted server heal without anyone
reloading - so closing the streams is not enough by itself. A reconnection that
lands on a connection the closing server still holds opens a fresh stream with
nothing left to close it, and the panel is held open all over again. Opening and
immediately closing one is no better: the page reconnects, and the loop holds
the panel just as the first stream did. Measured, that loop kept a "fixed" panel
alive for minutes. So the route answers 503 while stopping, which tells
`EventSource` to stop asking rather than to retry.

**The launcher outlives the panel it started.** A shell signals the job, which
is every process in it at once, and `bin/quarterdeck` - which has nothing to
tear down - always won that race. It now catches the signal instead of taking
it, passes it on, waits for the panel, and only then ends itself the same way it
was asked to, so the shell still reports the stop it requested. Nothing the
panel says on its way out can land after the prompt any more, because the prompt
comes last.

**A stop nobody in the terminal asked for is named.** If something outside the
terminal signals the server alone, the launcher used to print a stack trace -
`Error: node exited with 143`, which is the standalone server saying it stopped
politely, read as a crash. It now says what happened in one line and exits with
the same status. An operator whose panel disappears has to be able to find out
why; silence would be the defect.

## What was ruled out

The panel does not signal itself, and nothing in `src/` or `bin/` signals a
running panel. The suite kills only children it spawned. `bin/fm-teardown.sh`
selects what to reap with `lsof -a -d cwd` strictly under a finishing task's own
worktree or tasktmp, and re-verifies each pid's start time before killing it; a
panel started in the primary checkout has its cwd under neither, and neither
does the `fm-fleet-snapshot.sh` child it spawns, which inherits that cwd and
never changes directory. So teardown as written cannot have reaped this panel.
Nothing in the fleet kills by port, by command name, or by an `lsof -iTCP`
sweep; `bin/fm-watch-arm.sh` says in as many words never to `pkill -f`. The one
other process-group kill, in `bin/fm-supervise-daemon.sh`, targets a pid that
script spawned and holds in a variable of its own. So what sent the original
signal is not established here, and is recorded as open rather than guessed at.

One thing did turn up while looking. This worktree's `tests/real-fleet.test.ts`
derives port 45229, which is the port a panel in the primary checkout binds, so
that file cannot run locally while such a panel is up. `startPanel` refused it
loudly and named the occupant and the command to find it, which is
`docs/decisions/2026-09-01-a-suite-owns-its-ports.md` working exactly as
designed. It is a property of the derivation rather than of any change: the port
comes out the same with and without the file added here, and only a sibling
checkout running a panel can produce it, so CI never sees it. Verified passing
on a free port.

## What is checked

`tests/shutdown.test.ts`. A panel with a page watching it stops; a stopped panel
lets go of its port; and the launcher, driven the way a shell drives it, is
still there when the panel is gone. All three fail on the code as it was, with
the harness's own "its shutdown is hanging" sentence.
