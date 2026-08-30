/**
 * One violation, and the one place its message is shaped.
 *
 * These messages are written for an agent to act on, not for a person to
 * decode: what broke, why the rule exists, and the concrete edit that fixes it.
 * A single formatter means the shape is asserted once and every check inherits
 * it, so a new check cannot quietly invent a new format.
 */
export interface Violation {
  /** Kebab-case rule name, printed after the `x`. */
  readonly slug: string;
  /** Repo-relative path. */
  readonly file: string;
  readonly line: number;
  /** One sentence: what happened, then the rule. */
  readonly what: string;
  /** One sentence: why the rule exists. */
  readonly why: string;
  /** The correction, concretely enough to apply. */
  readonly fix: string;
  /** Where the rule is written down, e.g. "docs/ARCHITECTURE.md - layers". */
  readonly doc: string;
}

const WIDTH = 76;

function wrap(text: string, indent: string): string {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && `${line} ${word}`.length > WIDTH) {
      out.push(indent + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(indent + line);
  return out.join("\n");
}

export function formatViolation(v: Violation): string {
  return [
    `x ${v.slug}  ${v.file}:${v.line}`,
    wrap(v.what, "  "),
    wrap(v.why, "  "),
    wrap(v.fix, "  "),
    `  See ${v.doc}.`,
  ].join("\n");
}

export function formatViolations(violations: readonly Violation[]): string {
  return violations.map(formatViolation).join("\n\n");
}
