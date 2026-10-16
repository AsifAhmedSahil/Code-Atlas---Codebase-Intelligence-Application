import {
  Node,
  Project,
  SyntaxKind,
  ts,
  type CallExpression,
  type SourceFile,
} from "ts-morph";
import type { EdgeKind } from "./types";

export interface RawImport {
  kind: EdgeKind;
  // null for a dynamic import whose argument is not a string literal.
  specifier: string | null;
  line: number;
}

// What a CommonJS module offers, read from the assignments that build it. A
// `require()` call is an import like any other, but the *exports* side has no
// ESM equivalent the parser records, so this stays internal: it is used to
// decide `isModule` and to let a test prove a `module.exports =` was understood.
export interface CommonJsExports {
  // True when the file assigns the whole of `module.exports`.
  default: boolean;
  // The names assigned with `exports.x = …` or `module.exports.x = …`, in source
  // order and deduplicated.
  named: string[];
}

export interface ExtractedFile {
  imports: RawImport[];
  commonJs: CommonJsExports;
  isModule: boolean;
}

// One project reused across files; each source file is added, read, then
// dropped so memory stays flat on a large repository.
const project = new Project({
  skipAddingFilesFromTsConfig: true,
  compilerOptions: { allowJs: true, jsx: ts.JsxEmit.Preserve },
});

export function extractImports(
  absolutePath: string,
  content: string,
): ExtractedFile {
  const sourceFile = project.createSourceFile(absolutePath, content, {
    overwrite: true,
  });
  try {
    const imports: RawImport[] = [];

    // Plain imports: default, named, namespace, side-effect and `import type`
    // alike. Each is a real dependency.
    for (const declaration of sourceFile.getImportDeclarations()) {
      imports.push({
        kind: "import",
        specifier: declaration.getModuleSpecifierValue(),
        line: declaration.getStartLineNumber(),
      });
    }

    // Re-exports: `export ... from` and `export * from`. A declaration with no
    // module specifier re-exports something local and is not an edge.
    for (const declaration of sourceFile.getExportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      if (specifier !== undefined) {
        imports.push({
          kind: "re-export",
          specifier,
          line: declaration.getStartLineNumber(),
        });
      }
    }

    // Calls: `import(…)` and CommonJS `require(…)`. Both name a dependency, and
    // both are recorded with the same `import` kind as a static import so the
    // same module reached twice through different syntax becomes one edge once
    // duplicates are removed. Anything whose argument is not a single string
    // literal is not a readable edge and is left out rather than guessed.
    for (const call of sourceFile.getDescendantsOfKind(
      SyntaxKind.CallExpression,
    )) {
      const expression = call.getExpression();

      if (expression.getKind() === SyntaxKind.ImportKeyword) {
        const argument = call.getArguments()[0];
        const literal =
          argument &&
          (Node.isStringLiteral(argument) ||
            Node.isNoSubstitutionTemplateLiteral(argument))
            ? argument.getLiteralValue()
            : null;
        imports.push({
          kind: "dynamic",
          specifier: literal,
          line: call.getStartLineNumber(),
        });
        continue;
      }

      // Only a bare `require(…)` call. `require.resolve(…)`, `module.require(…)`
      // and a `require` that is not exactly one string literal argument are not
      // dependencies this parser can read, and are not reported as failures
      // either: they carry no specifier the module system would act on.
      if (Node.isIdentifier(expression) && expression.getText() === "require") {
        const specifier = singleStringArgument(call);
        if (specifier !== null) {
          imports.push({
            kind: "import",
            specifier,
            line: call.getStartLineNumber(),
          });
        }
      }
    }

    const commonJs = readCommonJsExports(sourceFile);

    const isModule =
      ts.isExternalModule(sourceFile.compilerNode) ||
      imports.length > 0 ||
      commonJs.default ||
      commonJs.named.length > 0;

    return { imports, commonJs, isModule };
  } finally {
    project.removeSourceFile(sourceFile);
  }
}

// The one string literal a `require(…)` call needs to name a module. A no-arg,
// multi-argument, template-with-substitution or variable argument yields null.
function singleStringArgument(call: CallExpression): string | null {
  const args = call.getArguments();
  if (args.length !== 1) return null;
  const argument = args[0];
  if (
    Node.isStringLiteral(argument) ||
    Node.isNoSubstitutionTemplateLiteral(argument)
  ) {
    return argument.getLiteralValue();
  }
  return null;
}

// The exports a CommonJS file publishes, read from assignment. Only the plain
// forms are understood — `module.exports = …`, `exports.x = …` and
// `module.exports.x = …`. A computed name (`exports[x]`), a defineProperty, or
// a plain object literal assigned to `module.exports` is described by the
// `default` flag at most, never by inventing names for it.
function readCommonJsExports(sourceFile: SourceFile): CommonJsExports {
  const commonJs: CommonJsExports = { default: false, named: [] };
  const seen = new Set<string>();

  for (const assignment of sourceFile.getDescendantsOfKind(
    SyntaxKind.BinaryExpression,
  )) {
    if (
      assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken
    ) {
      continue;
    }
    const left = assignment.getLeft();

    if (isModuleExports(left)) {
      commonJs.default = true;
      continue;
    }

    const name = assignedExportName(left);
    if (name !== null && !seen.has(name)) {
      seen.add(name);
      commonJs.named.push(name);
    }
  }

  return commonJs;
}

// `module.exports` as a whole expression.
function isModuleExports(node: Node): boolean {
  return (
    Node.isPropertyAccessExpression(node) &&
    node.getName() === "exports" &&
    Node.isIdentifier(node.getExpression()) &&
    node.getExpression().getText() === "module"
  );
}

// The name in `exports.x = …` or `module.exports.x = …`, or null when the
// assignment is not a supported named export. Computed access (`exports["x"]`)
// is a different node kind and does not match.
function assignedExportName(node: Node): string | null {
  if (!Node.isPropertyAccessExpression(node)) return null;
  const owner = node.getExpression();
  if (Node.isIdentifier(owner) && owner.getText() === "exports") {
    return node.getName();
  }
  if (isModuleExports(owner)) {
    return node.getName();
  }
  return null;
}

