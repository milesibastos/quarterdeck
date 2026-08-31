import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import type { Violation } from "./violation.ts";
import {
  importsOf,
  layerOf,
  readSourceFiles,
  targetLayerOf,
  type Layer,
  type SourceFile,
} from "./source.ts";

/**
 * The invariants, as checks.
 *
 * Every one of these is a boundary an agent cannot forget, because forgetting
 * it fails `npm test`. Each takes a root directory rather than assuming `src/`,
 * so the suite can point a check at a deliberately broken tree and prove the
 * check reports it - the checks themselves have to be known-good, since
 * everything else rests on them.
 */

const ARCH = "docs/ARCHITECTURE.md";

/**
 * Which layers each layer may import from. Same-layer imports are always fine.
 *
 * This table is the layer model. `app` is the composition position - Next owns
 * `src/app/` and `src/proxy.ts` - and it is the only place allowed to see both
 * a way of reading the fleet and a way of rendering it.
 */
export const ALLOWED_IMPORTS: Readonly<Record<Layer, readonly Layer[]>> = {
  types: [],
  providers: ["types"],
  config: ["types", "providers"],
  adapters: ["types", "config", "providers"],
  // `adapters` only as a type-only import; see checkForwardDependencies.
  domain: ["types", "config", "providers"],
  runtime: ["types", "config", "providers", "adapters", "domain"],
  ui: ["types", "providers"],
  app: ["types", "config", "providers", "adapters", "domain", "runtime", "ui"],
};

/**
 * Comments are prose. Scanning them for code patterns only finds false alarms
 * - but `//` and `/*` inside a string, template or JSX text are not comments
 * at all. Two earlier versions of this function tried to tell the difference
 * with hand-rolled rules (an empty-string replace that shifted line numbers,
 * then a quote-tracking walk that desynced on an apostrophe in JSX prose) and
 * both shipped a real bug. TypeScript's own parser already classifies every
 * character correctly - JSX, strings, template literals, regex literals - so
 * this asks it directly instead of re-deriving that grammar by hand.
 */
/**
 * `.tsx` needs JSX-aware parsing; `.ts` must NOT get it. A generic arrow with
 * no trailing comma - `<T>(x: T): T => x`, ordinary in a `.ts` file - reads as
 * an unclosed JSX tag under TSX parsing, and everything after it collapses
 * into one JsxText leaf that stripComments cannot see into.
 */
function scriptKindOf(path: string): ts.ScriptKind {
  return path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function commentRanges(text: string, path: string): ts.CommentRange[] {
  const sourceFile = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKindOf(path),
  );

  const ranges: ts.CommentRange[] = [];
  const seen = new Set<string>();
  const add = (found: readonly ts.CommentRange[] | undefined) => {
    for (const range of found ?? []) {
      const key = `${range.pos}:${range.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ranges.push(range);
    }
  };

  // Only leaf tokens - the ones getChildren() cannot expand further - carry
  // real trivia. A comment on its own line is leading trivia of the token
  // after it; one trailing code on the same line (`x = 1; // note`) is
  // trailing trivia of the token before it instead, so both are checked.
  const visit = (node: ts.Node) => {
    const children = node.getChildren(sourceFile);
    if (children.length === 0) {
      add(ts.getLeadingCommentRanges(text, node.getFullStart()));
      add(ts.getTrailingCommentRanges(text, node.end));
      return;
    }
    for (const child of children) visit(child);
  };
  visit(sourceFile);

  return ranges.sort((a, b) => a.pos - b.pos);
}

export function stripComments(text: string, path: string): string {
  let out = "";
  let i = 0;
  for (const { pos, end } of commentRanges(text, path)) {
    if (pos < i) continue;
    out += text.slice(i, pos);
    // Every non-newline character is blanked rather than the comment
    // dropped, so line numbers below still land on the true source line.
    for (let j = pos; j < end; j += 1) out += text[j] === "\n" ? "\n" : " ";
    i = end;
  }
  out += text.slice(i);
  return out;
}

function codeLines(file: SourceFile): { line: number; text: string }[] {
  return stripComments(file.text, file.path)
    .split("\n")
    .map((text, i) => ({ line: i + 1, text }));
}

/* ------------------------------------------------------------------ 1 */

export function checkForwardDependencies(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const from = layerOf(file.path);
    // `ui` has its own, stricter check; see checkUiIsolation.
    if (!from || from === "ui") continue;

    for (const ref of importsOf(file)) {
      const to = targetLayerOf(file.path, ref.specifier);
      if (!to || to === from) continue;
      if (ALLOWED_IMPORTS[from].includes(to)) continue;
      // A type-only import is erased before anything runs, so it cannot carry
      // behaviour across a boundary. The projection needs the snapshot's shape.
      if (from === "domain" && to === "adapters" && ref.typeOnly) continue;

      violations.push({
        slug: "forward-dependency",
        file: `src/${file.path}`,
        line: ref.line,
        what: `${from} imported from ${to}. Dependencies point forward only.`,
        why: `The layer order is types, config, adapters, domain, runtime, ui. Nothing reaches around a layer and nothing reaches back, which is what stops the panel collapsing into one tangled module.`,
        fix:
          from === "domain" && to === "adapters"
            ? `Make it a type-only import (import type { ... }) if you need the snapshot's shape, or move the read into adapters/contract.ts and add the value to the document type in types/document.ts.`
            : `Move what you need into a layer ${from} is allowed to import (${ALLOWED_IMPORTS[from].join(", ") || "none"}), or do the wiring in src/app/, which is the composition position.`,
        doc: `${ARCH} - layers`,
      });
    }
  }
  return violations;
}

/* ------------------------------------------------------------------ 2 */

export function checkDomainPurity(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (layerOf(file.path) !== "domain") continue;
    for (const ref of importsOf(file)) {
      if (!ref.specifier.startsWith("node:")) continue;
      violations.push({
        slug: "domain-purity",
        file: `src/${file.path}`,
        line: ref.line,
        what: `domain imported ${ref.specifier}. The projection performs no I/O.`,
        why: `Keeping domain free of Node builtins is what lets the projection be tested against fixtures with no fleet, no filesystem and no clock of its own present.`,
        fix: `Do the read in src/adapters/, pass the result into the projection as an argument, and take anything ambient - the time, logging - from src/providers/.`,
        doc: `${ARCH} - invariant 2`,
      });
    }
  }
  return violations;
}

/* ------------------------------------------------------------------ 3 */

export const PERMITTED_WRITER = "src/adapters/intent.ts";
export const WRITER_MARKER = "quarterdeck:permitted-writer";

/**
 * Starting a process is its own capability, and it has its own one file.
 *
 * A real fleet publishes its snapshot through a command rather than a file, so
 * the panel has to be able to start one - but "reads a fleet" and "can run
 * anything" are different claims, and only the first is true. The spawn door
 * confines the second the way the writer marker confines writing: one file, one
 * marker, and a failing build for any other file that reaches for it.
 */
export const PERMITTED_SPAWNER = "src/providers/process.ts";
export const SPAWNER_MARKER = "quarterdeck:permitted-spawner";

/**
 * APIs that mutate something outside this process. Reads are not listed.
 *
 * Matched as imported names and as member calls (`fs.writeFile(`), never as
 * bare words: `link` and `truncate` are also Tailwind class names, and a check
 * that cries wolf on a stylesheet is a check people start ignoring.
 */
const WRITE_APIS = [
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "createWriteStream",
  "mkdir",
  "mkdirSync",
  "mkdtemp",
  "mkdtempSync",
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
  "unlink",
  "unlinkSync",
  "rename",
  "renameSync",
  "truncate",
  "truncateSync",
  "chmod",
  "chmodSync",
  "chown",
  "chownSync",
  "symlink",
  "symlinkSync",
  "copyFile",
  "copyFileSync",
  "write",
  "writeSync",
  "cp",
  "cpSync",
];

/** Importing either of these at all means the file can run a second process. */
const SPAWN_MODULES = ["node:child_process", "child_process"];

/** Importing any of these at all means the file can reach outside the process. */
const WRITE_MODULES = [...SPAWN_MODULES, "node:worker_threads", "worker_threads"];

const MEMBER_WRITE = new RegExp(`\\.(${WRITE_APIS.join("|")})\\s*\\(`);
/** The same calls, reached through bracket notation: `fs["writeFile"](`. */
const MEMBER_WRITE_BRACKET = new RegExp(`\\[\\s*["'\`](${WRITE_APIS.join("|")})["'\`]\\s*\\]\\s*\\(`);

/**
 * Changing the working directory is not writing a record - it is reaching
 * outside the process, the same family as spawning - so it is checked
 * alongside WRITE_MODULES rather than folded into the writer's fs exemption.
 */
const PROCESS_MODULES = ["node:process", "process"];
const CHDIR_MEMBER = /\.chdir\s*\(/;
const CHDIR_MEMBER_BRACKET = /\[\s*["'`]chdir["'`]\s*\]\s*\(/;

/** Named imports from a module: `import { a, b as c } from "..."`. */
function namedImportsFrom(text: string, module: string): string[] {
  const pattern = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${module}["']`, "g");
  const names: string[] = [];
  for (const match of text.matchAll(pattern)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (name) names.push(name);
    }
  }
  return names;
}

/**
 * Local identifiers bound to the whole module, however that happens: a default
 * import, a namespace import, or a `require()` call assigned to a variable.
 * `import { writeFile } from "node:fs/promises"` is not a bypass on its own -
 * it is what `namedImportsFrom` already sees - but `import fsp from "..."`
 * followed by `const { writeFile } = fsp` puts the same capability one hop away.
 */
function moduleAliasesOf(text: string, module: string): string[] {
  const aliases: string[] = [];
  for (const match of text.matchAll(
    new RegExp(`import\\s+(?:\\*\\s+as\\s+)?(\\w+)\\s*from\\s*["']${module}["']`, "g"),
  )) {
    aliases.push(match[1]);
  }
  for (const match of text.matchAll(
    new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*require\\(\\s*["']${module}["']\\s*\\)`, "g"),
  )) {
    aliases.push(match[1]);
  }
  return aliases;
}

/**
 * Names pulled out of a destructuring assignment whose right-hand side matches
 * `sourcePattern` - either a module alias (`fsp`) or a `require(...)` call.
 * `{ writeFile: w }` is tracked under its source name, `writeFile`, since that
 * is the capability that matters; the local name after the colon is discarded.
 */
function destructuredFrom(text: string, sourcePattern: string): string[] {
  const names: string[] = [];
  const pattern = new RegExp(`\\{([^}]*)\\}\\s*=\\s*${sourcePattern}`, "g");
  for (const match of text.matchAll(pattern)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().split(":")[0].trim();
      if (name) names.push(name);
    }
  }
  return names;
}

/**
 * The two confined capabilities, checked the same way: exactly one file carries
 * the marker, and it is the file named here.
 */
const MARKED_CAPABILITIES = [
  { path: PERMITTED_WRITER, marker: WRITER_MARKER, verb: "write anything" },
  { path: PERMITTED_SPAWNER, marker: SPAWNER_MARKER, verb: "start a process" },
] as const;

export function checkSingleWriter(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];

  for (const { path, marker, verb } of MARKED_CAPABILITIES) {
    const marked = files.filter((f) => f.text.includes(marker));

    for (const file of marked) {
      if (`src/${file.path}` === path) continue;
      violations.push({
        slug: "single-writer",
        file: `src/${file.path}`,
        line: file.lines.findIndex((l) => l.includes(marker)) + 1,
        what: `A second file claims the ${marker} marker. Exactly one file may ${verb}, and it is ${path}.`,
        why: `The whole safety argument for a panel that will act on a live fleet is that acting is confined to one reviewable file. Two markers means nobody can tell by reading one file what the panel can do.`,
        fix: `Remove the marker from this file and move the call into ${path}, calling it from here.`,
        doc: `${ARCH} - invariant 3`,
      });
    }

    if (marked.length === 0 && files.some((f) => `src/${f.path}` === path)) {
      violations.push({
        slug: "single-writer",
        file: path,
        line: 1,
        what: `The ${marker} marker is missing. Exactly one file may ${verb}, and it must say so.`,
        why: `The marker is what the check reads. Without it there is no file the build can point at as the one file holding this capability, and the confinement stops being verifiable.`,
        fix: `Restore the ${marker} line to the header comment of ${path}.`,
        doc: `${ARCH} - invariant 3`,
      });
    }
  }

  for (const file of files) {
    // The writer's exemption is narrow: it may mutate the filesystem, and
    // that is all. child_process, worker_threads and process.chdir stay
    // banned inside it exactly as they are everywhere else, so the file that
    // can write is still a file that cannot spawn.
    const writerPermitted = `src/${file.path}` === PERMITTED_WRITER;
    // The spawn door holds one capability, not both: it may start a process,
    // and every write API below is still banned in it.
    const spawnPermitted = `src/${file.path}` === PERMITTED_SPAWNER;
    const code = stripComments(file.text, file.path);
    // One report per file and API: naming the import line and every use of it
    // says the same thing several times and buries the next finding.
    const reported = new Set<string>();
    const fsModules = ["node:fs", "node:fs/promises"];
    const imported = new Set([
      ...fsModules.flatMap((m) => namedImportsFrom(code, m)),
      // `import fsp from "node:fs/promises"; const { writeFile } = fsp;`
      ...fsModules.flatMap((m) =>
        moduleAliasesOf(code, m).flatMap((alias) => destructuredFrom(code, `${alias}\\b`)),
      ),
      // `const { writeFile } = require("node:fs/promises");`
      ...fsModules.flatMap((m) =>
        destructuredFrom(code, `require\\(\\s*["']${m}["']\\s*\\)`),
      ),
    ]);
    const chdirImported = new Set(
      [
        ...PROCESS_MODULES.flatMap((m) => namedImportsFrom(code, m)),
        ...PROCESS_MODULES.flatMap((m) =>
          moduleAliasesOf(code, m).flatMap((alias) => destructuredFrom(code, `${alias}\\b`)),
        ),
        ...PROCESS_MODULES.flatMap((m) =>
          destructuredFrom(code, `require\\(\\s*["']${m}["']\\s*\\)`),
        ),
      ].filter((name) => name === "chdir"),
    );

    for (const { line, text } of codeLines(file)) {
      const found: string[] = [];

      for (const ref of importsOf({ ...file, text, lines: [text] })) {
        if (!WRITE_MODULES.includes(ref.specifier)) continue;
        if (spawnPermitted && SPAWN_MODULES.includes(ref.specifier)) continue;
        found.push(ref.specifier);
      }
      // Changing the working directory is banned everywhere, the permitted
      // writer included - it is not part of the fs-write exemption.
      if (CHDIR_MEMBER.test(text) || CHDIR_MEMBER_BRACKET.test(text)) found.push("chdir");
      if (chdirImported.has("chdir") && /\bchdir\s*\(/.test(text)) found.push("chdir");
      if (!writerPermitted) {
        for (const name of imported) {
          if (WRITE_APIS.includes(name) && new RegExp(`\\b${name}\\b`).test(text)) {
            found.push(name);
          }
        }
        const member = MEMBER_WRITE.exec(text);
        if (member) found.push(member[1]);
        const bracket = MEMBER_WRITE_BRACKET.exec(text);
        if (bracket) found.push(bracket[1]);
      }

      for (const api of new Set(found)) {
        if (reported.has(api)) continue;
        reported.add(api);
        violations.push({
          slug: "single-writer",
          file: `src/${file.path}`,
          line,
          what: writerPermitted
            ? `${api} used in ${PERMITTED_WRITER}. That file may write a file and nothing more - only ${PERMITTED_SPAWNER} may start a process.`
            : `${api} used outside ${PERMITTED_WRITER}. Exactly one file may write anything, and only ${PERMITTED_SPAWNER} may start a process.`,
          why: `Everything but those files is read-only by construction. A write here means the question "what can this panel change?" can no longer be answered by reading a single file.`,
          fix: SPAWN_MODULES.includes(api)
            ? `Take a Runner from ${PERMITTED_SPAWNER} and pass it in, the way src/adapters/contract.ts does for the fleet snapshot command.`
            : api === "chdir"
              ? `Do not change the process's working directory. Take an absolute path from src/config/ instead.`
              : `Move the mutation into ${PERMITTED_WRITER} behind an Intent, and call it from here. If this is genuinely a read, use the reading form of the API instead.`,
          doc: `${ARCH} - invariant 3`,
        });
      }
    }
  }
  return violations;
}

/* ------------------------------------------------------------------ 4 */

export const QUARANTINED_MODULE = "src/adapters/health.ts";

/** The app's own URL space. Everything else starting with `/` is a machine path. */
const ROUTE_PREFIXES = [/^\/api\//, /^\/api$/, /^\/_next\//, /^\/\(/];

export function checkPathQuarantine(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (`src/${file.path}` === QUARANTINED_MODULE) continue;
    for (const { line, text } of codeLines(file)) {
      for (const match of text.matchAll(/["'`](~\/[^"'`]*|\/[^"'`\s]*\/[^"'`]*)["'`]/g)) {
        const literal = match[1];
        if (ROUTE_PREFIXES.some((p) => p.test(literal))) continue;
        violations.push({
          slug: "path-quarantine",
          file: `src/${file.path}`,
          line,
          what: `The literal "${literal}" names an absolute path. Only ${QUARANTINED_MODULE} may name fleet-internal paths.`,
          why: `Fleet-internal paths are the one dependency that carries no compatibility promise. Confining them to one file means that when upstream moves, exactly one file's tests fail and exactly one file needs editing.`,
          fix: `Take the path from configuration instead - src/config/ reads it from the environment - or, if it really is a fleet-internal path, read it in ${QUARANTINED_MODULE}, which degrades to unknown rather than throwing when it moves.`,
          doc: `${ARCH} - invariant 4`,
        });
      }
      for (const api of ["homedir", "userInfo"]) {
        if (!text.includes(api)) continue;
        violations.push({
          slug: "path-quarantine",
          file: `src/${file.path}`,
          line,
          what: `${api} used outside ${QUARANTINED_MODULE}. Only that file may reach for machine-specific locations.`,
          why: `A home directory is the root of every fleet-internal path. Letting any file derive one puts the unstable dependency everywhere.`,
          fix: `Take the location from src/config/, which reads it from the environment, or move the lookup into ${QUARANTINED_MODULE}.`,
          doc: `${ARCH} - invariant 4`,
        });
      }
      // Dotted, bracketed (`process.env["HOME"]`) or destructured
      // (`const { HOME } = process.env`) - all three reach the same value.
      if (
        /process\.env\.HOME\b/.test(text) ||
        /process\.env\[\s*["'`]HOME["'`]\s*\]/.test(text) ||
        /\{[^}]*\bHOME\b[^}]*\}\s*=\s*process\.env\b/.test(text)
      ) {
        violations.push({
          slug: "path-quarantine",
          file: `src/${file.path}`,
          line,
          what: `process.env.HOME used outside ${QUARANTINED_MODULE}. Only that file may reach for machine-specific locations.`,
          why: `A home directory is the root of every fleet-internal path. Letting any file derive one puts the unstable dependency everywhere.`,
          fix: `Take the location from src/config/, which reads it from the environment, or move the lookup into ${QUARANTINED_MODULE}.`,
          doc: `${ARCH} - invariant 4`,
        });
      }
    }
  }
  return violations;
}

/* ------------------------------------------------------------------ 5 */

export const CONTRACT_MODULE = "src/adapters/contract.ts";

export function checkPinnedContract(files: readonly SourceFile[]): Violation[] {
  const contract = files.find((f) => `src/${f.path}` === CONTRACT_MODULE);
  if (!contract) return [];

  const violations: Violation[] = [];
  const code = stripComments(contract.text, contract.path);
  const declaration = /const\s+SNAPSHOT_SCHEMA_ID\s*=\s*["'][^"']+["']/.exec(code);

  if (!declaration) {
    violations.push({
      slug: "pinned-contract",
      file: CONTRACT_MODULE,
      line: 1,
      what: `SNAPSHOT_SCHEMA_ID is not declared as a string literal. The contract version is pinned and parsed at the boundary.`,
      why: `A changed upstream contract must refuse loudly rather than render something plausible and wrong. An identifier that is computed, or absent, cannot be compared against.`,
      fix: `Declare "const SNAPSHOT_SCHEMA_ID = \\"fm-fleet-snapshot.v1\\";" in ${CONTRACT_MODULE} and compare every parsed snapshot against it.`,
      doc: "docs/contract.md - the pinned identifier",
    });
    return violations;
  }

  // A comparison only defends the pin if the other side is some parsed value,
  // not the identifier compared against itself: `X === X` matches the same
  // shape as `value.schema === X` but proves nothing.
  let comparedAgainstValue = false;
  for (const match of code.matchAll(/([\w.$[\]]+)\s*(?:!==|===)\s*([\w.$[\]]+)/g)) {
    const [, left, right] = match;
    if ((left === "SNAPSHOT_SCHEMA_ID") !== (right === "SNAPSHOT_SCHEMA_ID")) {
      comparedAgainstValue = true;
      break;
    }
  }
  if (!comparedAgainstValue) {
    violations.push({
      slug: "pinned-contract",
      file: CONTRACT_MODULE,
      line: contract.lines.findIndex((l) => l.includes("SNAPSHOT_SCHEMA_ID")) + 1,
      what: `SNAPSHOT_SCHEMA_ID is declared but never compared. The contract version is pinned and parsed at the boundary.`,
      why: `A pin nobody checks is a comment. A snapshot whose shape changed would parse into fields whose meaning has shifted, and the panel would render it as though nothing happened.`,
      fix: `Compare the parsed snapshot's schema field against SNAPSHOT_SCHEMA_ID before reading any other field, and throw ContractIdentifierError on a mismatch.`,
      doc: "docs/contract.md - the pinned identifier",
    });
  }
  return violations;
}

/* ------------------------------------------------------------------ 6 */

export function checkUiIsolation(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (layerOf(file.path) !== "ui") continue;
    for (const ref of importsOf(file)) {
      const to = targetLayerOf(file.path, ref.specifier);
      if (!to || to === "ui" || ALLOWED_IMPORTS.ui.includes(to)) continue;
      violations.push({
        slug: "ui-isolation",
        file: `src/${file.path}`,
        line: ref.line,
        what: `ui imported from ${to}. Components read the document type and providers, and nothing else.`,
        why: `Keeping fleet reading out of rendering is what makes the panel replaceable, and what stops a component growing a "just fetch this one extra field" shortcut that quietly ties the UI to upstream's shape.`,
        fix: `Add what this component needs to the document type in src/types/document.ts, fill it in the projection in src/domain/, and pass it down as a prop from src/app/.`,
        doc: `${ARCH} - invariant 6`,
      });
    }
  }
  return violations;
}

/* ------------------------------------------------------------------ 7 */

export function checkNoEgress(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    for (const ref of importsOf(file)) {
      if (!/^next\/font\/google/.test(ref.specifier)) continue;
      violations.push({
        slug: "no-egress",
        file: `src/${file.path}`,
        line: ref.line,
        what: `${ref.specifier} imported. Nothing is loaded from the network at runtime.`,
        why: `A local tool that degrades without internet fails its own honesty rules. Fonts and libraries are carried in the repository, never fetched.`,
        fix: `Commit the woff2 subset under src/ui/fonts/ and load it with next/font/local, as src/ui/fonts/fonts.ts already does.`,
        doc: `${ARCH} - invariant 7`,
      });
    }
    for (const { line, text } of codeLines(file)) {
      // Both `https://host` and protocol-relative `//host` reach the network;
      // the second is invisible to a check that only knows `https?://`.
      for (const match of text.matchAll(
        /["'`]((?:wss?|https?):\/\/[^"'`\s]+|\/\/[^"'`\s]+\.[^"'`\s]+)["'`]/g,
      )) {
        violations.push({
          slug: "no-egress",
          file: `src/${file.path}`,
          line,
          what: `The literal "${match[1]}" is a remote URL. Nothing is loaded from the network at runtime.`,
          why: `A local tool that degrades without internet fails its own honesty rules, and the panel's Content-Security-Policy allows only 'self' - so a remote URL fails silently in the browser rather than loudly here.`,
          fix: `Carry the resource in the repository and reference it by a same-origin path, or delete the reference.`,
          doc: `${ARCH} - invariant 7`,
        });
      }
    }
  }
  return violations;
}

/* ------------------------------------------ beyond the seven: provider door */

/**
 * Not one of the seven, but the reason `src/providers/` exists: nothing reaches
 * for the wall clock or the console directly. `Date.parse` is pure and stays.
 */
export function checkProviderBypass(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  const probes: [RegExp, string][] = [
    [/\bDate\.now\s*\(/, "Date.now()"],
    [/\bnew Date\s*\(\s*\)/, "new Date()"],
    [/\bconsole\.\w+\s*\(/, "console"],
    // `console['log'](...)` reaches the same global through a bracket.
    [/\bconsole\[\s*["'`]\w+["'`]\s*\]\s*\(/, "console"],
  ];
  for (const file of files) {
    if (layerOf(file.path) === "providers") continue;
    const code = stripComments(file.text, file.path);
    // `const D = Date; D.now()` renames the global before reaching for it;
    // the probes above only know the literal spelling `Date`.
    const aliasProbes: [RegExp, string][] = [];
    for (const match of code.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*Date\s*[;\n]/g)) {
      const alias = match[1];
      aliasProbes.push(
        [new RegExp(`\\b${alias}\\.now\\s*\\(`), "Date.now()"],
        [new RegExp(`\\bnew\\s+${alias}\\s*\\(\\s*\\)`), "new Date()"],
      );
    }
    for (const { line, text } of codeLines(file)) {
      for (const [pattern, name] of [...probes, ...aliasProbes]) {
        if (!pattern.test(text)) continue;
        violations.push({
          slug: "provider-bypass",
          file: `src/${file.path}`,
          line,
          what: `${name} used outside src/providers/. The clock and the logger are dependencies, not globals.`,
          why: `Staleness is a comparison against "now", so a hard-coded clock makes it untestable without waiting for real time to pass; scattered console calls make the panel impossible to quieten or structure later.`,
          fix: `Take a Clock from src/providers/clock.ts or a Logger from src/providers/logger.ts, and pass it in. Date.parse is pure and stays.`,
          doc: `${ARCH} - providers`,
        });
      }
    }
  }
  return violations;
}

/* ------------------------------------------------------------------ all */

export const CHECKS = {
  "forward-dependency": checkForwardDependencies,
  "domain-purity": checkDomainPurity,
  "single-writer": checkSingleWriter,
  "path-quarantine": checkPathQuarantine,
  "pinned-contract": checkPinnedContract,
  "ui-isolation": checkUiIsolation,
  "no-egress": checkNoEgress,
  "provider-bypass": checkProviderBypass,
} as const;

export type CheckName = keyof typeof CHECKS;

export function runChecks(rootDir: string, only?: CheckName): Violation[] {
  const files = readSourceFiles(rootDir);
  const names = only ? [only] : (Object.keys(CHECKS) as CheckName[]);
  return names.flatMap((name) => CHECKS[name](files));
}

/** Directory names under `tests/violations/`, one planted tree per check. */
export function plantedTrees(root: string): string[] {
  return readdirSync(root).filter((name) => statSync(join(root, name)).isDirectory());
}
