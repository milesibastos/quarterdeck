/**
 * What the panel remembers about the operator, rather than about a fleet.
 *
 * There is exactly one such thing: which fleet they were last looking at. It
 * lives in a cookie, which is to say in their browser - a choice about a view
 * is theirs and not the machine's, two browsers pointed at the same panel may
 * honestly disagree, and remembering it this way needs no second writer. The
 * panel writes nothing outside `src/adapters/intent.ts`, and this is one of the
 * reasons it still does not have to.
 *
 * The name is here, at the head of the layer order, because both ends need it:
 * `src/ui/` sets the cookie in the browser and `src/app/` reads it off the
 * request. Neither may import the other's layer, and both may import this one.
 */

/** The cookie holding the id of the fleet the operator last selected. */
export const FLEET_COOKIE = "quarterdeck.fleet";

/**
 * How long the panel remembers a selection: a year, refreshed on every switch.
 *
 * Long enough that "it is still pointed where I left it" holds across a machine
 * being rebooted, rather than only across an afternoon.
 */
export const FLEET_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
