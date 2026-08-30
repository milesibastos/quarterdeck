import { SESSION_HEADER, isValidSession } from "@/runtime/session.ts";

/**
 * The acting guard, in front of a write path that does not exist yet.
 *
 * Everything under `/api/act` requires the session secret minted at start.
 * Reading requires none of this. The guard is here before the first acting
 * endpoint so there is never a build in which an acting route ships ahead of
 * the check that protects it.
 */
export const dynamic = "force-dynamic";

function guarded(request: Request): Response {
  if (!isValidSession(request.headers.get(SESSION_HEADER))) {
    return Response.json(
      { error: `Missing or invalid ${SESSION_HEADER}.` },
      { status: 403 },
    );
  }
  return Response.json(
    {
      error:
        "Quarterdeck is read-only in this build. See src/adapters/intent.ts, the only file permitted to write.",
    },
    { status: 501 },
  );
}

export const GET = guarded;
export const POST = guarded;
