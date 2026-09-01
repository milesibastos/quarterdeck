# The panel band clears every kernel

Date: 2026-09-01
Status: accepted

Closes the gap `2026-09-01-the-band-still-sat-in-the-kernels-range.md` named
and deliberately left open: that decision moved the _suite's_ ports clear of
the kernel and noted the _panel's_ range had the same fault, unfixed, because
fixing it moves every operator's URL.

## Context

`derivePort` put every checkout's panel in 45000-45999. That band clears
macOS's ephemeral floor and nothing else. Four ranges bound where a band may
sit - one of them reaching into 45000-45999 itself - each read from a source
rather than from memory:

| Range       | Who allocates from it                       | Source                                                                                    |
| ----------- | ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 32768-60999 | Linux ephemeral source ports                | `cat /proc/sys/net/ipv4/ip_local_port_range`, observed in a stock container on 2026-09-01 |
| 49152-65535 | macOS ephemeral source ports                | `sysctl net.inet.ip.portrange.first` on this fleet's machines, reads 49152                |
| 49152-65535 | Windows ephemeral, and IANA's dynamic range | Microsoft's documented default since Vista; RFC 6335 §6                                   |
| 30000-32767 | Kubernetes NodePort services                | kube-apiserver `--service-node-port-range` default                                        |

45000-45999 sits inside the first of those. So on Linux the kernel may already
be holding a port a panel is about to bind, as an outbound connection's source
port: the panel then fails to bind, or races whatever holds it. This fleet has
never seen it because macOS allocates from 49152 and the whole band sits below
that - the defect is invisible on the machine it was written on and live the
day anyone runs the panel on Linux. It was found from CI by
`qd-port-derivation-collision-j1` and escalated rather than fixed in place,
which was the right call, because of the consequence below.

## Decision

**The band moves to 28000-28999.**

There was almost no choice to make once the constraints were written down.
Under 32768 (Linux), under 30000 (NodePort), and clear of 29000-29999 (this
suite's own band, from the decision above), exactly one whole thousand is
left: 28000-28999. It is under 49152 for macOS, Windows and IANA as well, and
over 1024, which the panel has no privilege to bind below.

`src/config/port.ts` is the only file that names the band. The three floors
above it now live in `tests/lib/band.ts`, beside the suite's band, with the
source for each - they were previously a `49152` literal in
`tests/port.test.ts` and a `LINUX_EPHEMERAL_FLOOR` local to
`tests/harness.test.ts`.

**Which thousand is not clean, and saying so is the point.** `/etc/services`
(macOS's copy, a subset of the IANA registry) lists two registered ports in
28000-28999: `nxlmd` on 28000 and `siemensgsm` on 28240. The decision above
rejected 20000-20999 partly because DNP3 sits on 20000 itself, and the same
objection applies here in miniature. It is weaker: a SCADA protocol on the
band's first port is a listener a real machine plausibly runs, an NX license
manager is not, a derivation reaches either one about once in a thousand
paths, and `bin/quarterdeck`'s port-taken check refuses to start rather than
colliding silently. Against that, the alternative is 27000-27999, which has
five registered services and, unregistered, the FlexLM license managers on
27000-27010 and Steam on 27015-27030 - both far more common on a real
workstation. Two known names beat that.

## What is deliberately not here

Nothing detects a port conflict, retries a bind, or scans for a free port. A
panel that scans answers on a different URL each run, which is the one thing
the derivation exists to prevent; `bin/quarterdeck`'s existing check, which
refuses and names what is on the port, is the whole of the conflict story and
it did not change. The derivation itself - SHA-256 of the absolute path, first
four bytes, modulo the size - is untouched, so the same path still yields the
same port on every run and every machine.

**What is not cleared:** FreeBSD's ephemeral floor is far lower than any of
the four above - `net.inet.ip.portrange.first` is documented as 10000 in
`ip(4)`, which was not observed on a FreeBSD machine because this fleet has
none - so 28000 sits inside it, as 45000-45999 did. FreeBSD was out of the
target set; the next person to move this band should know that rather than
read it as an oversight.

## Consequences

**Every derived port changes, so every bookmarked panel URL breaks.** A
checkout that answered on 45659 now answers on some number in 28000-28999.
This is a real cost to whoever uses the panel daily, and it is the reason this
change went to the captain rather than landing on the strength of the
engineering.

An operator who wants a URL back does not need anything new to be built:
`QUARTERDECK_PORT` already overrides the derivation (`bin/quarterdeck`), so
pinning the old number per checkout is a line of environment and no code. And
`npm start` prints the URL it bound, so the new port is one command away for
everyone else. A hint that printed "this used to be 45xxx" would be machinery
the panel carries forever to serve one afternoon.

`tests/port.test.ts` was rewritten to assert the properties rather than the
arithmetic: that a path is stable, that paths spread across every hundred of
the band, that every derived port is inside it, and that the band's boundaries
clear each floor named above. No test names a port number.

The gap entry in `docs/quality.md` is closed.
