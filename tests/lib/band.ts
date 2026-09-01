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
 */
export const TEST_BAND_START = 29000;
export const TEST_BAND_SIZE = 1000;
