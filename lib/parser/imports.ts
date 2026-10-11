import { Node, Project, SyntaxKind, ts } from "ts-morph";
import type { EdgeKind } from "./types";

export interface RawImport {
  kind: EdgeKind;
  // null for a dynamic import whose argument is not a string literal.
  specifier: string | null;
  line: number;
}

export interface ExtractedFile {
  imports: RawImport[];
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

    // Dynamic import(). Only a string-literal argument is an edge; anything
    // else is reported as a failure rather than guessed at.
    for (const call of sourceFile.getDescendantsOfKind(
      SyntaxKind.CallExpression,
    )) {
      if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
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
    }

    return { imports, isModule: ts.isExternalModule(sourceFile.compilerNode) };
  } finally {
    project.removeSourceFile(sourceFile);
  }
}
