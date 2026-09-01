/**
 * The band this suite's ports come from, disjoint from the panel's and clear
 * of every port the kernel might hand itself.
 *
 * Test ports used to be derived into 45000-45999 - the same thousand
 * `derivePort` puts every checkout's panel in - and so a suite could land on a
 * panel that some other checkout was running. That is not a hash collision and
 * it is not rare: with ninety-one ports drawn across the suite, one foreign
 * panel has about a one-in-eleven chance of sitting on one, and the reserved
 * blocks cover four hundred and sixty-four of the thousand. On 2026-09-01 a
 * worker in a disposable worktree drew 45229 and met the primary checkout's own
 * panel on it; see `docs/decisions/2026-09-01-test-ports-live-above-the-panels.md`.
 *
 * A band of its own removes that case entirely rather than making it rarer: no
 * panel can derive into this band, because `derivePort` cannot reach it. What
 * a band cannot remove is another checkout's *suite*, which derives into this
 * same band - that one is unfixable without coordination, and `startPanel`'s
 * occupancy check is what covers it.
 *
 * The band moved a second time, later the same day: 46000-46999 sits below
 * macOS's ephemeral floor (49152) but not Linux's, which defaults to 32768 -
 * so on a Linux runner the kernel hands that band out as an *outbound* source
 * port too. This suite's own test clients open hundreds of connections to the
 * panels under test, each drawing a source port from that range; one landing
 * on a port a not-yet-started panel is about to `listen()` on produces the
 * same EADDRINUSE a foreign panel would, except transient - the squatter is a
 * client, not a listener, so nothing still answers by the time anything goes
 * looking. The band now sits below both floors, and below 30000-32767, which
 * Kubernetes reserves for NodePort services a runner might have bound. It is
 * also the emptiest thousand available: 29000-29999 carries one registered
 * service in `/etc/services`, against thirty in 20000-20999 - among them
 * DNP3 on 20000 itself, which is a listener a real machine may well be
 * running.
 *
 * The panel's own band later moved for the same reason and by the same
 * argument - out of 45000-45999, which sat inside Linux's ephemeral range too,
 * and into 28000-28999, the one thousand left under all of these floors once
 * this band had taken 29000-29999. So the two bands are no longer disjoint
 * because the suite climbed above the panels; they are disjoint because the
 * panels came down beside the suite. See
 * `docs/decisions/2026-09-01-the-panel-band-clears-every-kernel.md`.
 */
export const TEST_BAND_START = 29000;
export const TEST_BAND_SIZE = 1000;

/**
 * The ceilings both bands sit under, in one place so no test file states one
 * as a literal. Every number here was taken from a source, not from memory:
 *
 * - `LINUX_EPHEMERAL_FLOOR`: `/proc/sys/net/ipv4/ip_local_port_range` reads
 *   `32768 60999` on a stock kernel, observed in a container on 2026-09-01.
 * - `KUBERNETES_NODEPORT_FLOOR`: kube-apiserver's `--service-node-port-range`
 *   defaults to 30000-32767, which a CI runner may have services bound in.
 *
 * macOS, Windows and IANA's dynamic range all start at 49152 - `sysctl
 * net.inet.ip.portrange.first` reads it on this fleet's machines, Microsoft
 * has documented it since Vista, and RFC 6335 names it. There is no constant
 * for it: it is the loosest of the floors, so a band under Linux's 32768 is
 * under it already, and asserting it separately is what let 46000-46999 look
 * safe once. Under both floors is the only thing worth stating.
 */
export const LINUX_EPHEMERAL_FLOOR = 32768;
export const KUBERNETES_NODEPORT_FLOOR = 30000;
