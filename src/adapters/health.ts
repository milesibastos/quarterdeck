import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isIsoInstant } from "../providers/clock.ts";
import type {
  Disagreement,
  DriftSignal,
  Health,
  Overdue,
  OverdueSignal,
  SupervisorSignal,
} from "../types/document.ts";

/**
 * THE QUARANTINED MODULE.
 *
 * This is the only file permitted to name fleet-internal paths (invariant 4).
 * Those paths are an implementation detail of the fleet supervisor and carry no
 * compatibility promise: they get renamed, moved, and restructured without
 * notice. Confining them here means that when upstream moves, exactly one
 * file's tests fail and exactly one file needs editing.
 *
 * The rule that comes with that privilege: **this module degrades, it does not
 * throw.** A path that has moved must produce an unreadable reading, never an
 * exception that takes the panel down. That is also why the shipshape lens gets
 * its own status in the document: the fleet snapshot either parses or refuses,
 * but health can simply go dark while the other two lenses keep working.
 *
 * The health file's shape is the panel's own, not upstream's - nothing upstream
 * publishes these signals, so there is no contract to pin and nothing to guess.
 */

export type HealthReading =
  | {
      readonly read: "ok";
      /** ISO-8601 instant the reading was taken. */
      readonly asOf: string;
      readonly health: Health;
    }
  | { readonly read: "unreadable"; readonly detail: string };

/**
 * Thrown and caught inside this file only. The module's whole contract is that
 * nothing escapes it, so this type is not exported.
 */
class HealthParseError extends Error {}

function fail(detail: string): never {
  throw new HealthParseError(detail);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
  return isRecord(value) ? value : fail(`${path} must be an object`);
}

function text(value: unknown, path: string): string {
  return typeof value === "string" && value.length > 0
    ? value
    : fail(`${path} must be a non-empty string`);
}

function instant(value: unknown, path: string): string {
  const found = text(value, path);
  return isIsoInstant(found) ? found : fail(`${path} must be an ISO-8601 instant`);
}

function flag(value: unknown, path: string): boolean {
  return typeof value === "boolean" ? value : fail(`${path} must be a boolean`);
}

function list(value: unknown, path: string): unknown[] {
  return Array.isArray(value) ? value : fail(`${path} must be an array`);
}

/**
 * `{ read: "unreadable", detail }` when the signal itself could not be read,
 * `null` when it was and the caller should read the rest of it.
 *
 * A signal being dark is different from the whole file being dark: the
 * supervisor can be readable while the drift check is not.
 */
function unreadableSignal(
  entry: Record<string, unknown>,
  path: string,
): { readonly read: "unreadable"; readonly detail: string } | null {
  const read = text(entry.read, `${path}.read`);
  if (read === "unreadable") {
    return { read: "unreadable", detail: text(entry.detail, `${path}.detail`) };
  }
  if (read !== "ok") fail(`${path}.read must be "ok" or "unreadable"`);
  return null;
}

function parseSupervisor(value: unknown): SupervisorSignal {
  const entry = record(value, "supervisor");
  return (
    unreadableSignal(entry, "supervisor") ?? {
      read: "ok",
      alive: flag(entry.alive, "supervisor.alive"),
      lastSeen: instant(entry.lastSeen, "supervisor.lastSeen"),
    }
  );
}

function parseOverdue(value: unknown): OverdueSignal {
  const entry = record(value, "overdue");
  const dark = unreadableSignal(entry, "overdue");
  if (dark) return dark;
  const overdue = list(entry.overdue, "overdue.overdue").map((item, i): Overdue => {
    const at = `overdue.overdue[${i}]`;
    const row = record(item, at);
    return {
      id: text(row.id, `${at}.id`),
      waitingSince: instant(row.waitingSince, `${at}.waitingSince`),
    };
  });
  return { read: "ok", overdue };
}

function parseDrift(value: unknown): DriftSignal {
  const entry = record(value, "drift");
  const dark = unreadableSignal(entry, "drift");
  if (dark) return dark;
  const disagreements = list(entry.disagreements, "drift.disagreements").map(
    (item, i): Disagreement => {
      const at = `drift.disagreements[${i}]`;
      const row = record(item, at);
      return {
        record: text(row.record, `${at}.record`),
        detail: text(row.detail, `${at}.detail`),
      };
    },
  );
  return { read: "ok", disagreements };
}

function parseHealth(raw: string): HealthReading {
  const top = record(JSON.parse(raw), "top level");
  return {
    read: "ok",
    asOf: instant(top.asOf, "asOf"),
    health: {
      supervisor: parseSupervisor(top.supervisor),
      overdue: parseOverdue(top.overdue),
      drift: parseDrift(top.drift),
    },
  };
}

/**
 * Read the health signals from `dir`, which is a fleet-internal location and so
 * may only be named here.
 *
 * Every failure - a missing file, a moved directory, a shape that changed under
 * us - comes back as an unreadable reading. Nothing escapes this function, and
 * that is the point: a quarantined module that can take the panel down is not
 * quarantined.
 */
export async function readHealth(dir: string, signal: AbortSignal): Promise<HealthReading> {
  try {
    return parseHealth(await readFile(join(dir, "health.json"), { encoding: "utf8", signal }));
  } catch (error) {
    return {
      read: "unreadable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
