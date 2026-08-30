import { readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

/**
 * Reading the source as a graph, so the invariant checks have something to
 * check. Every check takes a root directory rather than hardcoding `src/`,
 * which is what makes it possible to run a check against a planted violation
 * and prove the check itself works.
 */

export interface SourceFile {
  /** Path relative to the scanned root, always with forward slashes. */
  readonly path: string;
  readonly text: string;
  readonly lines: readonly string[];
}

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

export function readSourceFiles(rootDir: string): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        const text = readFileSync(full, "utf8");
        files.push({
          path: relative(rootDir, full).split(sep).join(posix.sep),
          text,
          lines: text.split("\n"),
        });
      }
    }
  };
  walk(rootDir);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export interface ImportRef {
  /** The module specifier, verbatim. */
  readonly specifier: string;
  /** 1-indexed. */
  readonly line: number;
  /** `import type ...`, which is erased at compile time and cannot do I/O. */
  readonly typeOnly: boolean;
}

/**
 * Import statements, found over the whole file rather than line by line.
 *
 * Multi-line imports are the common shape once a module exports more than two
 * things, and a line-based scan silently misses every one of them - which would
 * make every check below quietly incomplete.
 *
 * The clause is matched with `[^;'"]` so it can span newlines without running
 * past the end of the statement into an unrelated `from` in some later string.
 */
const IMPORT_FROM = /\b(import|export)[ \t\n]+([^;'"]*?)[ \t\n]*from[ \t]*["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT = /\bimport[ \t]*["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport[ \t]*\([ \t\n]*["']([^"']+)["']/g;

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text[i] === "\n") line += 1;
  return line;
}

export function importsOf(file: SourceFile): ImportRef[] {
  const refs: ImportRef[] = [];
  const seen = new Set<number>();

  for (const match of file.text.matchAll(IMPORT_FROM)) {
    const at = match.index ?? 0;
    seen.add(at);
    refs.push({
      specifier: match[3],
      line: lineAt(file.text, at),
      typeOnly: /^type\b/.test(match[2].trim()),
    });
  }
  for (const match of file.text.matchAll(SIDE_EFFECT_IMPORT)) {
    const at = match.index ?? 0;
    if (seen.has(at)) continue;
    refs.push({ specifier: match[1], line: lineAt(file.text, at), typeOnly: false });
  }
  for (const match of file.text.matchAll(DYNAMIC_IMPORT)) {
    const at = match.index ?? 0;
    refs.push({ specifier: match[1], line: lineAt(file.text, at), typeOnly: false });
  }

  return refs.sort((a, b) => a.line - b.line);
}

/**
 * The layer a file belongs to.
 *
 * `src/app/**` and `src/proxy.ts` are the composition position: Next owns those
 * filenames, and invariant 6 keeps fleet reading out of `src/ui/`, so the
 * wiring has to live somewhere that is neither. See docs/ARCHITECTURE.md.
 */
export const LAYERS = [
  "types",
  "providers",
  "config",
  "adapters",
  "domain",
  "runtime",
  "ui",
  "app",
] as const;

export type Layer = (typeof LAYERS)[number];

export function layerOf(path: string): Layer | null {
  if (path.startsWith("app/") || path === "proxy.ts") return "app";
  const head = path.split("/")[0];
  return (LAYERS as readonly string[]).includes(head) ? (head as Layer) : null;
}

/**
 * Which layer an import points at, or `null` for anything that is not an
 * in-repo layer import (npm packages, and relative paths inside one layer).
 */
export function targetLayerOf(fromPath: string, specifier: string): Layer | null {
  if (specifier.startsWith("@/")) return layerOf(specifier.slice(2));
  if (!specifier.startsWith(".")) return null;
  const dir = posix.dirname(fromPath);
  return layerOf(posix.normalize(posix.join(dir, specifier)));
}
