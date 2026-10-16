import { Node, Project, type Decorator } from "ts-morph";
import type { AdapterFile, AdapterRoute, FrameworkAdapter } from "../framework";

// NestJS. Roles come from the filename suffix (`cats.controller.ts`,
// `cats.service.ts`, ...), and a route is assembled from two decorators read
// together: `@Controller('cats')` on the class sets the prefix and `@Get(':id')`
// on the method supplies the rest. Either half has to be a string literal; if it
// is not, the route is dropped rather than guessed.

const project = new Project({
  skipAddingFilesFromTsConfig: true,
  compilerOptions: { allowJs: true },
});

const CONTROLLER_FILE = /\.controller\.[cm]?[jt]s$/;
const MODULE_FILE = /\.module\.[cm]?[jt]s$/;
const SERVICE_FILE = /\.service\.[cm]?[jt]s$/;
const ENTITY_FILE = /\.entity\.[cm]?[jt]s$/;

const VERBS: Record<string, string> = {
  Get: "GET",
  Post: "POST",
  Put: "PUT",
  Patch: "PATCH",
  Delete: "DELETE",
  Head: "HEAD",
  Options: "OPTIONS",
};

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

// The string a `@Controller`/verb decorator contributes to the path. An empty
// argument list or an empty string is "no extra segment"; a non-literal argument
// is not recoverable, so the caller drops the route.
function decoratorPath(decorator: Decorator): string | null {
  const args = decorator.getArguments();
  if (args.length === 0) return "";
  const first = args[0];
  if (Node.isStringLiteral(first) || Node.isNoSubstitutionTemplateLiteral(first)) {
    return first.getLiteralValue();
  }
  return null;
}

function joinPath(prefix: string, suffix: string): string {
  const parts = [prefix, suffix]
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter((part) => part.length > 0);
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

export const nestAdapter: FrameworkAdapter = {
  name: "nestjs",

  detect(context) {
    if (
      context.packages.has("@nestjs/core") ||
      context.packages.has("@nestjs/common")
    ) {
      return true;
    }
    // No dependency to read: fall back to the layout a Nest module always has —
    // a controller beside a module.
    const hasController = context.files.some((file) => CONTROLLER_FILE.test(file.path));
    const hasModule = context.files.some((file) => MODULE_FILE.test(file.path));
    return hasController && hasModule;
  },

  role(file) {
    if (CONTROLLER_FILE.test(file.path)) return "controller";
    if (SERVICE_FILE.test(file.path)) return "service";
    if (MODULE_FILE.test(file.path)) return "module";
    if (ENTITY_FILE.test(file.path)) return "entity";
    return null;
  },

  routes(context) {
    const routes: AdapterRoute[] = [];
    for (const file of context.files) {
      if (!CONTROLLER_FILE.test(file.path)) continue;
      withSource(file, (source) => {
        for (const declaration of source.getClasses()) {
          const controller = declaration.getDecorators().find(
            (decorator) => decorator.getName() === "Controller",
          );
          if (!controller) continue;
          const prefix = decoratorPath(controller);
          // A non-literal prefix cannot be resolved, so no route in this class
          // is claimed.
          if (prefix === null) continue;

          for (const method of declaration.getMethods()) {
            for (const decorator of method.getDecorators()) {
              const verb = VERBS[decorator.getName()];
              if (!verb) continue;
              const suffix = decoratorPath(decorator);
              if (suffix === null) continue;
              routes.push({
                kind: "api",
                method: verb,
                path: joinPath(prefix, suffix),
                file: file.path,
              });
            }
          }
        }
      });
    }
    return routes;
  },
};
