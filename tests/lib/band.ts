import { PORT_RANGE_SIZE, PORT_RANGE_START } from "../../src/config/port.ts";

/**
 * The band this suite's ports come from, disjoint from the panel's.
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
 * panel can derive into 46000-46999, because `derivePort` cannot reach it. What
 * a band cannot remove is another checkout's *suite*, which derives into this
 * same band - that one is unfixable without coordination, and `startPanel`'s
 * occupancy check is what covers it.
 *
 * It sits above the panel range and below the ephemeral range (49152+ on macOS
 * and Linux), so the kernel never hands one of these out first either.
 */
export const TEST_BAND_START = PORT_RANGE_START + PORT_RANGE_SIZE;
export const TEST_BAND_SIZE = 1000;
