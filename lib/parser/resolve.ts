import { statSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { ts } from "ts-morph";
import { isInsideRepository, toPosix } from "./paths";
import type { ImportOutcome } from "./types";

// Resolution uses the TypeScript module resolver, which already understands
// relative paths, index files, extension priority, tsconfig `paths` aliases and
// node_modules. The parser supplies the compiler options; it does not
// re-implement the module system.

// Non-code files a real import can legitimately point at. TypeScript will not
// resolve these, so the parser checks for them by hand and reports them as
// deliberately excluded rather than falsely unresolved.
const ASSET_EXTENSIONS: readonly string[] = [
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".styl",
  ".json",
  ".html",
  ".txt",
  ".md",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".wasm",
  ".graphql",
  ".gql",
  ".yaml",
  ".yml",
];

const BUILTIN_MODULES = new Set(builtinModules);

function isNodeBuiltin(specifier: string): boolean {
  const bare = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  return BUILTIN_MODULES.has(bare) || BUILTIN_MODULES.has(`node:${bare}`);
}

// A bare specifier is neither relative nor absolute: it names a package or a
// tsconfig alias rather than a path.
function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith(".") && !specifier.startsWith("/");
}

// Does a bare specifier match one of the tsconfig `paths` keys? A key may
// contain a single `*`; the rest must match literally.
function matchesAlias(specifier: string, aliases: readonly string[]): boolean {
  for (const alias of aliases) {
    const star = alias.indexOf("*");
    if (star === -1) {
      if (specifier === alias) return true;
      continue;
    }
    const prefix = alias.slice(0, star);
    const suffix = alias.slice(star + 1);
    if (
      specifier.length >= prefix.length + suffix.length &&
      specifier.startsWith(prefix) &&
      specifier.endsWith(suffix)
    ) {
      return true;
    }
  }
  return false;
}

function hasAssetExtension(specifier: string): boolean {
  return ASSET_EXTENSIONS.includes(path.extname(specifier).toLowerCase());
}

export function loadCompilerOptions(root: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  if (configPath) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (!read.error) {
      const parsed = ts.parseJsonConfigFileContent(
        read.config,
        ts.sys,
        path.dirname(configPath),
      );
      return parsed.options;
    }
  }
  // No tsconfig: resolve the way a bundler would, so `.ts`/`.tsx`/index files
  // and JSON still work.
  return {
    allowJs: true,
    resolveJsonModule: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    jsx: ts.JsxEmit.Preserve,
  };
}

export interface ResolveContext {
  root: string;
  options: ts.CompilerOptions;
  // The tsconfig `paths` keys ("@/*", "~/*", …). A bare specifier that matches
  // one addresses the project's own modules, so an unresolved one is a real gap
  // and is never swept up as an external package.
  aliases: readonly string[];
  // Lowercased repository-relative path -> canonical path, to resolve the case
  // differences Windows allows.
  nodeByPath: ReadonlyMap<string, string>;
  isIgnored: (relativePath: string) => boolean;
}

export interface ResolutionResult {
  outcome: ImportOutcome;
  target?: string;
  reason?: string;
}

export function resolveImport(
  specifier: string,
  containingFile: string,
  context: ResolveContext,
): ResolutionResult {
  if (isNodeBuiltin(specifier)) {
    return { outcome: "outside", reason: "node-builtin" };
  }

  const resolved = ts.resolveModuleName(
    specifier,
    containingFile,
    context.options,
    ts.sys,
  ).resolvedModule;

  if (!resolved) {
    // TypeScript cannot see a stylesheet or an image, but a relative specifier
    // pointing at one that exists is still deliberately excluded, not a
    // failure. Reporting it as unresolved would be a false alarm.
    const asset = findRepositoryAsset(specifier, containingFile, context.root);
    if (asset) {
      const reason = context.isIgnored(asset)
        ? "ignored-directory"
        : "not-a-source-module";
      return { outcome: "excluded", reason, target: asset };
    }

    if (isBareSpecifier(specifier)) {
      // A bare specifier that matches a tsconfig alias points inside the
      // repository: an unresolved one is a genuine gap, so it stays a failure.
      if (matchesAlias(specifier, context.aliases)) {
        return { outcome: "failed", reason: "module-not-found" };
      }
      // A bare specifier naming a non-code file is a package's own asset (a
      // stylesheet, say) rather than a module. That is deliberately excluded,
      // exactly like a relative asset, not a missing internal import.
      if (hasAssetExtension(specifier)) {
        return { outcome: "excluded", reason: "not-a-source-module" };
      }
      // Everything else is a third-party package. It is unresolved only because
      // its code is not in the analysed tree; it points outside the repository,
      // so it is not an internal gap.
      return { outcome: "outside", reason: "external-package-unresolved" };
    }

    return { outcome: "failed", reason: "file-not-found" };
  }

  const absolute = path.normalize(resolved.resolvedFileName);
  const relative = toPosix(path.relative(context.root, absolute));
  const inside = isInsideRepository(relative);
  const external =
    resolved.isExternalLibraryImport === true ||
    /(^|\/)node_modules(\/|$)/.test(relative);

  if (external) return { outcome: "outside", reason: "external-package" };
  if (!inside) return { outcome: "outside", reason: "outside-root" };
  if (context.isIgnored(relative)) {
    return { outcome: "excluded", reason: "ignored-directory", target: relative };
  }

  const canonical = context.nodeByPath.get(relative.toLowerCase());
  if (canonical) return { outcome: "resolved", target: canonical };

  // Resolved to a real file inside the repository that is deliberately not a
  // node (a stylesheet, a JSON module, a declaration we chose not to keep).
  return { outcome: "excluded", reason: "not-a-source-module", target: relative };
}

function findRepositoryAsset(
  specifier: string,
  containingFile: string,
  root: string,
): string | null {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return null;
  const base = path.resolve(path.dirname(containingFile), specifier);
  const candidates = path.extname(base)
    ? [base]
    : ASSET_EXTENSIONS.map((extension) => `${base}${extension}`);
  for (const candidate of candidates) {
    if (!isFile(candidate)) continue;
    return toPosix(path.relative(root, candidate));
  }
  return null;
}

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}
