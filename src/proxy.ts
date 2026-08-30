import { NextResponse, type NextRequest } from "next/server";
import { checkRequest } from "./runtime/request-guard.ts";

/**
 * The server's front door.
 *
 * Two jobs, both of which the panel carries from the first commit even though
 * it only reads today: refuse requests that did not come from the operator's
 * own machine, and tell the browser it may not fetch anything from the network.
 *
 * The acting guard is not here - it needs the session secret, which needs the
 * Node runtime. It lives in the acting route itself; see
 * `src/app/api/act/[...intent]/route.ts`.
 *
 * Next calls this file convention `proxy`; it is the request middleware.
 */

/**
 * Invariant 7, enforced by the browser rather than by convention.
 *
 * Every directive resolves to `'self'`. Fonts and libraries are carried in the
 * repository, so a stylesheet or script that started pointing at a CDN would be
 * blocked here rather than quietly making the panel depend on the internet.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data:",
  "font-src 'self'",
  // Next inlines hydration data and its bootstrap script into the document.
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
].join("; ");

/**
 * The port this instance is bound to, straight from the environment `bin/
 * quarterdeck` and the test harness always set before spawning the server.
 * `src/config/` also knows this port, but deriving its default calls into
 * `node:crypto`, which the edge runtime this file runs in does not have; see
 * `docs/decisions/2026-08-30-security-baseline.md`. "3000" mirrors Next's own
 * default for the rare case nothing set `PORT` at all.
 */
function boundPort(): string {
  return process.env.PORT || "3000";
}

export default function proxy(request: NextRequest) {
  const verdict = checkRequest(
    {
      host: request.headers.get("host"),
      origin: request.headers.get("origin"),
    },
    boundPort(),
  );

  if (!verdict.ok) {
    return new NextResponse(`Quarterdeck refused the request: ${verdict.reason}\n`, {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const response = NextResponse.next();
  response.headers.set("content-security-policy", CONTENT_SECURITY_POLICY);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "no-referrer");
  // No `access-control-allow-*` is set anywhere, deliberately: another page
  // must not be able to read a response from this server even if it can reach it.
  return response;
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
