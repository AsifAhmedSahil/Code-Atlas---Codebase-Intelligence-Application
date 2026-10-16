import { Node, Project, ts } from "ts-morph";
import type { AdapterFile, AdapterRoute, FrameworkAdapter } from "../framework";
import { CONFIG_FILE } from "../../roles/taxonomy";

// Next.js. Roles come from the file conventions (a `page.tsx` is a page, a
// `route.ts` is an endpoint, a top-of-file `"use server"` is an action), and a
// route is the path convention read back as a URL. Nothing here checks an
// import: a page is reached by the router, not by another file.
//
// The path rules are exact. A segment the URL grammar cannot resolve — a
// parallel `@slot` or an intercepting `(.)` route — makes the whole route
// absent rather than a close-enough guess.

// One project reused across files; each source file is added, read, then
// dropped so memory stays flat on a large repository.
const project = new Project({
  skipAddingFilesFromTsConfig: true,
  compilerOptions: { allowJs: true, jsx: ts.JsxEmit.Preserve },
});

// The verbs a route handler may export, in the order a table reads them.
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

function withSource<T>(file: AdapterFile, read: (source: ReturnType<typeof createSource>) => T): T {
  const source = createSource(file);
  try {
    return read(source);
  } finally {
    project.removeSourceFile(source);
  }
}

function createSource(file: AdapterFile) {
  return project.createSourceFile(file.path, file.content, { overwrite: true });
}

function stripExtension(name: string): string | null {
  const stripped = name.replace(/\.[^./]+$/, "");
  return stripped === name ? null : stripped;
}

// The URL segments a folder maps to. A route group `(name)` adds no segment; a
// slot `@name` or an intercept `(.)`/`(..)` cannot appear in a URL, so it voids
// the route rather than being skipped.
function urlSegments(segments: readonly string[]): string[] | null {
  const kept: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment.startsWith("@")) return null;
    if (segment.startsWith("(") && segment.endsWith(")")) {
      if (segment.includes(".")) return null;
      continue;
    }
    kept.push(segment);
  }
  return kept;
}

function patternOf(segments: readonly string[]): string {
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

// The app and pages directories may sit at the repository root or under `src/`.
// Both are the framework's own convention; the offset is where content starts.
function appOffset(parts: readonly string[]): number | null {
  if (parts[0] === "app") return 1;
  if (parts[0] === "src" && parts[1] === "app") return 2;
  return null;
}

function pagesOffset(parts: readonly string[]): number | null {
  if (parts[0] === "pages") return 1;
  if (parts[0] === "src" && parts[1] === "pages") return 2;
  return null;
}

// `app/**/page.ext` or `app/**/route.ext` (or their `src/` forms) -> the URL
// pattern, or null when it is not that file or the pattern cannot be recovered.
function appPattern(path: string, base: "page" | "route"): string | null {
  const parts = path.split("/");
  const offset = appOffset(parts);
  if (offset === null) return null;
  if (stripExtension(parts[parts.length - 1]) !== base) return null;
  const segments = urlSegments(parts.slice(offset, -1));
  return segments === null ? null : patternOf(segments);
}

// The pages router: `pages/**` files. `pages/api` is an endpoint, everything
// else a page. Anything with an underscore segment (`_app`, `_document`) is a
// special file the router does not expose as a URL.
function pagesPattern(path: string): { kind: "page" | "api"; path: string } | null {
  const parts = path.split("/");
  const offset = pagesOffset(parts);
  if (offset === null) return null;
  const rest = parts.slice(offset);
  if (rest.length === 0) return null;
  const base = stripExtension(rest[rest.length - 1]);
  if (base === null) return null;
  if (rest.some((segment) => segment.startsWith("_"))) return null;
  const isApi = rest[0] === "api";
  const dirs = rest.slice(0, -1);
  const segments = base === "index" ? dirs : [...dirs, base];
  return { kind: isApi ? "api" : "page", path: patternOf(segments) };
}

// App Router conventions that live beside the page but are not routes: the shell
// (`layout`, `template`) and the loading / error boundaries. They resolve only
// inside an `app` directory, so a `layout.ts` elsewhere keeps its generic role.
const APP_ROLE_BY_BASE: Record<string, string> = {
  layout: "layout",
  template: "layout",
  loading: "loading-error",
  error: "loading-error",
  "global-error": "loading-error",
  "not-found": "loading-error",
};

// Metadata files the framework reads by name from inside the app directory.
const METADATA_BASES: ReadonlySet<string> = new Set([
  "sitemap",
  "robots",
  "manifest",
  "icon",
  "apple-icon",
  "opengraph-image",
  "twitter-image",
  "favicon",
]);

// Next.js reads middleware and instrumentation from the project root (or `src/`)
// by name. Next 16 renamed `middleware` to `proxy`; both are the same role.
const ROOT_ROLE_BY_BASE: Record<string, string> = {
  middleware: "middleware",
  proxy: "middleware",
  instrumentation: "instrumentation",
  "instrumentation-client": "instrumentation",
};

// Tooling tests read the same in every framework; they are claimed here so a
// detected repository never shows a raw extension category. Config files use the
// shared CONFIG_FILE pattern from the taxonomy.
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const TEST_DIR = /(^|\/)(__tests__|tests)\//;
const COMPONENT_FILE = /\.(tsx|jsx)$/;
const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const HOOK_NAME = /^use[A-Z0-9-]/;

// The file name without its extension, e.g. "layout" for `app/layout.tsx`.
function baseName(path: string): string | null {
  const name = path.split("/").pop();
  return name === undefined ? null : stripExtension(name);
}

// The base name of a file directly inside an app directory, or null.
function appBaseName(path: string): string | null {
  return appOffset(path.split("/")) === null ? null : baseName(path);
}

// A file at the project root or under a single `src/`, e.g. `middleware.ts` or
// `src/proxy.ts` — never deeper, so a `lib/proxy.ts` is not middleware.
function atRoot(path: string): boolean {
  const depth = path.split("/").length;
  return depth === 1 || (depth === 2 && path.startsWith("src/"));
}

// The exported HTTP verbs of a route handler, in table order. Only the ones the
// file actually exports are returned; the rest are simply absent.
function exportedMethods(file: AdapterFile): string[] {
  return withSource(file, (source) => {
    const exported = source.getExportedDeclarations();
    return METHODS.filter((method) => exported.has(method));
  });
}

// A top-of-file "use server" directive marks a server action file. It has to be
// the first statement to count, which is what the directive grammar requires.
function isServerAction(file: AdapterFile): boolean {
  return withSource(file, (source) => {
    const first = source.getStatements()[0];
    if (!Node.isExpressionStatement(first)) return false;
    const argument = first.getExpression();
    if (!Node.isStringLiteral(argument) && !Node.isNoSubstitutionTemplateLiteral(argument)) {
      return false;
    }
    return argument.getLiteralValue() === "use server";
  });
}

export const nextAdapter: FrameworkAdapter = {
  name: "nextjs",

  detect(context) {
    return (
      context.packages.has("next") ||
      context.files.some((file) => /(^|\/)next\.config\.[cm]?[jt]s$/.test(file.path))
    );
  },

  role(file) {
    const path = file.path;

    // Tooling config and tests first: they read the same in every framework and
    // must not be caught by a broader convention below.
    if (CONFIG_FILE.test(path)) return "config";
    if (TEST_FILE.test(path) || TEST_DIR.test(path)) return "test";

    // A convention file is resolved by its base name — inside the app directory
    // for pages, layouts and metadata, at the project root for middleware and
    // instrumentation. Anything else keeps its generic role below.
    const appBase = appBaseName(path);
    if (appBase !== null) {
      const convention = APP_ROLE_BY_BASE[appBase];
      if (convention !== undefined) return convention;
      if (METADATA_BASES.has(appBase)) return "metadata";
    }

    const base = baseName(path);
    if (base !== null && atRoot(path)) {
      const root = ROOT_ROLE_BY_BASE[base];
      if (root !== undefined) return root;
    }

    if (appPattern(path, "page") !== null) return "page-route";
    if (appPattern(path, "route") !== null) return "api-endpoint";
    const pages = pagesPattern(path);
    if (pages !== null) return pages.kind === "api" ? "api-endpoint" : "page-route";

    // A cheap substring test keeps the syntax parse off the common case; only a
    // file that mentions the directive is parsed to confirm it is at the top.
    if (file.content.includes("use server") && isServerAction(file)) return "server-action";

    if (base !== null && SOURCE_FILE.test(path) && HOOK_NAME.test(base)) return "hook";
    if (COMPONENT_FILE.test(path)) return "component";
    return null;
  },

  routes(context) {
    const routes: AdapterRoute[] = [];
    for (const file of context.files) {
      const routePath = appPattern(file.path, "route");
      if (routePath !== null) {
        for (const method of exportedMethods(file)) {
          routes.push({ kind: "api", method, path: routePath, file: file.path });
        }
        continue;
      }

      const pagePath = appPattern(file.path, "page");
      if (pagePath !== null) {
        routes.push({ kind: "page", method: null, path: pagePath, file: file.path });
        continue;
      }

      const pages = pagesPattern(file.path);
      // A pages-router page is a page. A pages-router API file exports a default
      // handler with no verb to read, so it gets no route row rather than a
      // guess.
      if (pages !== null && pages.kind === "page") {
        routes.push({ kind: "page", method: null, path: pages.path, file: file.path });
      }
    }
    return routes;
  },
};
