import ts from "typescript";
import type { SourceFile } from "./source.ts";
import type { Violation } from "./violation.ts";

/**
 * Whether a test file's `startPanel` calls draw their port from the file's own
 * allocator, checked the way `tests/lib/invariants.ts` checks the seven -
 * parsed with the compiler, not matched against source text.
 *
 * A regex over the source proves nothing: `const P = 45231; startPanel({ port:
 * P })` defeats a literal-only pattern while still picking a port by hand. The
 * AST is walked instead, and a `port` argument is only accepted once it is
 * traced back to a call on the name `portsFor(import.meta.filename)` bound in
 * this file - directly (`port: nextPort()`) or through a local
 * (`const port = nextPort(); startPanel({ port })`), both of which the suite
 * uses today.
 */

function isImportMetaFilename(expr: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(expr) &&
    expr.name.text === "filename" &&
    ts.isMetaProperty(expr.expression) &&
    expr.expression.keywordToken === ts.SyntaxKind.ImportKeyword
  );
}

/** Local names bound to `portsFor(import.meta.filename)` in this file. */
function allocatorNamesOf(root: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === "portsFor" &&
      node.initializer.arguments.length === 1 &&
      isImportMetaFilename(node.initializer.arguments[0])
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return names;
}

/** Every `const x = ...` in the file, keyed by name - `x` may be declared more than once, in different scopes. */
function declarationsByName(root: ts.Node): Map<string, ts.Expression[]> {
  const map = new Map<string, ts.Expression[]>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const list = map.get(node.name.text) ?? [];
      list.push(node.initializer);
      map.set(node.name.text, list);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return map;
}

/** The `port` property's value expression in `startPanel({ port: ..., ... })`. */
function portArgumentOf(call: ts.CallExpression): ts.Expression | undefined {
  const [arg] = call.arguments;
  if (!arg || !ts.isObjectLiteralExpression(arg)) return undefined;
  for (const prop of arg.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === "port"
    ) {
      return prop.initializer;
    }
    if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === "port") {
      return prop.name;
    }
  }
  return undefined;
}

/**
 * Whether `expr` traces back to a call on one of `allocatorNames`, following
 * local variables through their declarations. A numeric literal, or a name
 * declared from one, is never an allocator call - so `port: 45231` and
 * `const P = 45231; port: P` are both refused the same way.
 */
function isAllocatorDerived(
  expr: ts.Expression,
  allocatorNames: ReadonlySet<string>,
  declByName: ReadonlyMap<string, ts.Expression[]>,
  seen: Set<string> = new Set(),
): boolean {
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return allocatorNames.has(expr.expression.text);
  }
  if (ts.isIdentifier(expr)) {
    if (seen.has(expr.text)) return false;
    seen.add(expr.text);
    const decls = declByName.get(expr.text);
    if (!decls || decls.length === 0) return false;
    return decls.every((decl) =>
      isAllocatorDerived(decl, allocatorNames, declByName, seen),
    );
  }
  return false;
}

const WHY =
  "node --test runs test files in parallel, and two files on one port do not fail cleanly: " +
  "the second panel answers the first file's requests, and the stop waits on a child that is " +
  "not the one holding the port.";
const FIX =
  "Declare `const nextPort = portsFor(import.meta.filename);` once at the top of the file and " +
  "pass `nextPort()`, or a local drawn from it, for every panel.";
const DOC = "tests/lib/ports.ts - one block per test file";

export function checkHandPickedPorts(
  files: readonly SourceFile[],
): Violation[] {
  const violations: Violation[] = [];

  for (const file of files) {
    if (!file.path.endsWith(".test.ts")) continue;

    const sourceFile = ts.createSourceFile(
      file.path,
      file.text,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TS,
    );
    const allocatorNames = allocatorNamesOf(sourceFile);
    const declByName = declarationsByName(sourceFile);
    const lineOf = (node: ts.Node) =>
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1;

    let sawStartPanel = false;

    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "startPanel"
      ) {
        sawStartPanel = true;
        const portExpr = portArgumentOf(node);
        if (!portExpr) {
          violations.push({
            slug: "hand-picked-port",
            file: `tests/${file.path}`,
            line: lineOf(node),
            what: "startPanel is called without a port drawn from the allocator.",
            why: WHY,
            fix: FIX,
            doc: DOC,
          });
        } else if (!isAllocatorDerived(portExpr, allocatorNames, declByName)) {
          violations.push({
            slug: "hand-picked-port",
            file: `tests/${file.path}`,
            line: lineOf(portExpr),
            what: `"${portExpr.getText(sourceFile)}" is a port chosen by hand, not drawn from the file's own allocator.`,
            why: WHY,
            fix: FIX,
            doc: DOC,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    if (sawStartPanel && allocatorNames.size === 0) {
      violations.push({
        slug: "hand-picked-port",
        file: `tests/${file.path}`,
        line: 1,
        what: "This file starts a panel without claiming a port block of its own.",
        why: WHY,
        fix: FIX,
        doc: DOC,
      });
    }
  }

  return violations;
}
