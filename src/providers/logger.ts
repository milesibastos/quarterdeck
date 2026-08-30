/**
 * Logging, as a dependency.
 *
 * Nothing outside this file calls `console.*`. A panel that logs from twenty
 * scattered places cannot later be made quiet, structured, or routable without
 * touching twenty files.
 */
export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

function line(level: string, message: string, fields?: Record<string, unknown>) {
  const suffix = fields ? ` ${JSON.stringify(fields)}` : "";
  return `[quarterdeck] ${level} ${message}${suffix}`;
}

export const consoleLogger: Logger = {
  info: (m, f) => console.info(line("info", m, f)),
  warn: (m, f) => console.warn(line("warn", m, f)),
  error: (m, f) => console.error(line("error", m, f)),
};

/** Drops everything. For tests that would otherwise shout. */
export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
