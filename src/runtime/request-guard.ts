/**
 * What the server will answer, and from whom.
 *
 * The panel binds to loopback, but loopback is not a boundary on a shared
 * machine and it is no defence at all against a page in the operator's own
 * browser: any site can point a form or an image at http://127.0.0.1. So every
 * request states which host it believes it reached and, when the browser sends
 * one, which origin it came from, and both are checked here.
 *
 * Reading is guarded by these checks alone. Acting additionally requires the
 * session secret; see `session.ts`.
 */

/** Only loopback names. A request claiming any other host is not for us. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "localhost",
  "[::1]",
]);

type GuardVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

function hostname(hostHeader: string): string {
  // `[::1]:45000` and `127.0.0.1:45000` both split at the last colon.
  const at = hostHeader.lastIndexOf(":");
  if (at > hostHeader.lastIndexOf("]")) return hostHeader.slice(0, at);
  return hostHeader;
}

function checkHost(hostHeader: string | null): GuardVerdict {
  if (!hostHeader)
    return { ok: false, reason: "request carried no Host header" };
  const name = hostname(hostHeader);
  if (!LOOPBACK_HOSTS.has(name)) {
    return {
      ok: false,
      reason: `Host "${hostHeader}" is not a loopback address`,
    };
  }
  return { ok: true };
}

/**
 * `Origin` is absent on ordinary same-origin navigations, which is why its
 * absence is not itself a failure - but when a browser does send one, it must
 * be this panel's own origin: loopback, and on the port this instance is
 * bound to. A page served by some other loopback-bound process is not "us"
 * just because it also happens to be on 127.0.0.1.
 */
function checkOrigin(
  originHeader: string | null,
  expectedPort: string,
): GuardVerdict {
  if (originHeader === null) return { ok: true };
  let url: URL;
  try {
    url = new URL(originHeader);
  } catch {
    return { ok: false, reason: `Origin "${originHeader}" is not a URL` };
  }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(`${url.hostname}`)) {
    return {
      ok: false,
      reason: `Origin "${originHeader}" is not a loopback origin`,
    };
  }
  const port = url.port || "80";
  if (port !== expectedPort) {
    return {
      ok: false,
      reason: `Origin "${originHeader}" is not this panel's own origin (bound to port ${expectedPort})`,
    };
  }
  return { ok: true };
}

export function checkRequest(
  headers: { host: string | null; origin: string | null },
  expectedPort: string,
): GuardVerdict {
  const host = checkHost(headers.host);
  if (!host.ok) return host;
  return checkOrigin(headers.origin, expectedPort);
}
