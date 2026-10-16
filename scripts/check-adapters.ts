// Acceptance check for framework detection, roles and route extraction. Builds
// a throwaway repository per framework — a Next.js app, a NestJS API, a plain
// React library, and a repository that matches nothing — and asserts what the
// parser reports for each. Not part of the shipped app: run with `npx tsx`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseRepository } from "../lib/parser";
import type { ParseResult } from "../lib/parser/types";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "ok  " : "FAIL"}  ${label}  ->  ${JSON.stringify(actual)}` +
      (ok ? "" : `  (expected ${JSON.stringify(expected)})`),
  );
}

function write(root: string, relative: string, content: string): void {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function roleOf(result: ParseResult, file: string): string | undefined {
  return result.roles.find((entry) => entry.path === file)?.role;
}

function routesOf(result: ParseResult, file: string): string[] {
  return result.routes
    .filter((route) => route.file === file)
    .map((route) => `${route.method ?? "PAGE"} ${route.path}`)
    .sort();
}

async function main(): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "check-adapters-"));
  try {
  // --- Next.js: app router page, app router endpoint, a server action, and a
  //     pages-router page behind a route group. ---
  const next = path.join(root, "next-app");
  write(
    next,
    "package.json",
    JSON.stringify({ dependencies: { next: "16.4.0", react: "19.3.0" } }),
  );
  write(next, "app/page.tsx", "export default function Home() { return null; }\n");
  write(
    next,
    "app/(marketing)/pricing/page.tsx",
    "export default function Pricing() { return null; }\n",
  );
  write(
    next,
    "app/api/users/[id]/route.ts",
    "export async function GET() { return Response.json({}); }\n" +
      "export async function DELETE() { return new Response(null); }\n",
  );
  write(next, "app/actions.ts", '"use server";\nexport async function save() {}\n');
  write(
    next,
    "pages/legacy.tsx",
    "export default function Legacy() { return null; }\n",
  );
  // A parallel slot cannot appear in a URL: no route, but still an endpoint
  // role because it is a route.ts by convention.
  write(next, "app/@modal/route.ts", "export async function GET() { return null; }\n");

  const nextResult = await parseRepository(next);
  check("next: adapter", nextResult.adapter, "nextjs");
  check("next: app page role", roleOf(nextResult, "app/page.tsx"), "page-route");
  check(
    "next: grouped page role",
    roleOf(nextResult, "app/(marketing)/pricing/page.tsx"),
    "page-route",
  );
  check(
    "next: endpoint role",
    roleOf(nextResult, "app/api/users/[id]/route.ts"),
    "api-endpoint",
  );
  check("next: server action role", roleOf(nextResult, "app/actions.ts"), "server-action");
  check("next: pages role", roleOf(nextResult, "pages/legacy.tsx"), "page-route");
  check("next: app page route", routesOf(nextResult, "app/page.tsx"), ["PAGE /"]);
  check("next: route group dropped from URL", routesOf(nextResult, "app/(marketing)/pricing/page.tsx"), [
    "PAGE /pricing",
  ]);
  check("next: endpoint methods", routesOf(nextResult, "app/api/users/[id]/route.ts"), [
    "DELETE /api/users/[id]",
    "GET /api/users/[id]",
  ]);
  check("next: pages-router route", routesOf(nextResult, "pages/legacy.tsx"), ["PAGE /legacy"]);
  check("next: parallel slot has no route", routesOf(nextResult, "app/@modal/route.ts"), []);

  // A file the adapter did not recognize is honestly unclassified, not "ts":
  // a detected framework never falls back to extension categories.
  check(
    "next: unrecognized file is unclassified",
    roleOf(nextResult, "app/@modal/route.ts"),
    "unclassified",
  );
  check(
    "next: no extension roles",
    [...new Set(nextResult.roles.map((entry) => entry.role))].filter(
      (role) => role === "ts" || role === "tsx" || role === "js",
    ),
    [],
  );

  // --- Next.js under `src/`: the layout this project actually ships. App
  //     Router behind the `src/` prefix, root-level middleware (Next 16 renamed
  //     it to `proxy`), metadata, a tooling config, a test, a component and a
  //     hook. This is the case the generic-extension rail got wrong. ---
  const nextSrc = path.join(root, "next-src");
  write(
    nextSrc,
    "package.json",
    JSON.stringify({ dependencies: { next: "16.4.0", react: "19.3.0" } }),
  );
  write(nextSrc, "next.config.ts", "export default {};\n");
  write(nextSrc, "src/proxy.ts", "export function proxy() {}\n");
  write(nextSrc, "src/instrumentation.ts", "export function register() {}\n");
  write(
    nextSrc,
    "src/app/layout.tsx",
    "export default function Layout({ children }) { return children; }\n",
  );
  write(nextSrc, "src/app/page.tsx", "export default function Home() { return null; }\n");
  write(nextSrc, "src/app/loading.tsx", "export default function Loading() { return null; }\n");
  write(nextSrc, "src/app/error.tsx", "export default function Error() { return null; }\n");
  write(nextSrc, "src/app/sitemap.ts", "export default function sitemap() { return []; }\n");
  write(
    nextSrc,
    "src/app/products/[slug]/page.tsx",
    "export default function Product() { return null; }\n",
  );
  // A destructured export is how a Next 16 auth handler re-exports its verbs.
  write(
    nextSrc,
    "src/app/api/auth/[...all]/route.ts",
    "const handler = {};\nexport const { GET, POST } = handler;\n",
  );
  write(nextSrc, "src/components/button.tsx", "export function Button() { return null; }\n");
  write(nextSrc, "src/hooks/use-thing.ts", "export function useThing() { return 0; }\n");
  write(nextSrc, "src/lib/money.ts", "export const money = 1;\n");
  write(nextSrc, "src/lib/money.test.ts", "export const t = 1;\n");

  const nextSrcResult = await parseRepository(nextSrc);
  check("next-src: adapter", nextSrcResult.adapter, "nextjs");
  check("next-src: layout role", roleOf(nextSrcResult, "src/app/layout.tsx"), "layout");
  check("next-src: page role", roleOf(nextSrcResult, "src/app/page.tsx"), "page-route");
  check("next-src: loading role", roleOf(nextSrcResult, "src/app/loading.tsx"), "loading-error");
  check("next-src: error role", roleOf(nextSrcResult, "src/app/error.tsx"), "loading-error");
  check("next-src: metadata role", roleOf(nextSrcResult, "src/app/sitemap.ts"), "metadata");
  check(
    "next-src: endpoint role",
    roleOf(nextSrcResult, "src/app/api/auth/[...all]/route.ts"),
    "api-endpoint",
  );
  check("next-src: middleware role", roleOf(nextSrcResult, "src/proxy.ts"), "middleware");
  check(
    "next-src: instrumentation role",
    roleOf(nextSrcResult, "src/instrumentation.ts"),
    "instrumentation",
  );
  check(
    "next-src: component role",
    roleOf(nextSrcResult, "src/components/button.tsx"),
    "component",
  );
  check("next-src: hook role", roleOf(nextSrcResult, "src/hooks/use-thing.ts"), "hook");
  check("next-src: config role", roleOf(nextSrcResult, "next.config.ts"), "config");
  check("next-src: test role", roleOf(nextSrcResult, "src/lib/money.test.ts"), "test");
  check("next-src: unclassified role", roleOf(nextSrcResult, "src/lib/money.ts"), "unclassified");
  check("next-src: src page route", routesOf(nextSrcResult, "src/app/page.tsx"), ["PAGE /"]);
  check(
    "next-src: src dynamic route",
    routesOf(nextSrcResult, "src/app/products/[slug]/page.tsx"),
    ["PAGE /products/[slug]"],
  );
  check(
    "next-src: destructured verbs",
    routesOf(nextSrcResult, "src/app/api/auth/[...all]/route.ts"),
    ["GET /api/auth/[...all]", "POST /api/auth/[...all]"],
  );
  check(
    "next-src: no extension roles",
    [...new Set(nextSrcResult.roles.map((entry) => entry.role))].filter(
      (role) => role === "ts" || role === "tsx" || role === "js",
    ),
    [],
  );

  // --- NestJS: two controllers, a service and a module. ---
  const nest = path.join(root, "nest-api");
  write(
    nest,
    "package.json",
    JSON.stringify({ dependencies: { "@nestjs/core": "11.0.0", "@nestjs/common": "11.0.0" } }),
  );
  write(
    nest,
    "src/cats/cats.controller.ts",
    "import { Controller, Get, Post } from '@nestjs/common';\n" +
      "@Controller('cats')\n" +
      "export class CatsController {\n" +
      "  @Get()\n" +
      "  findAll() {}\n" +
      "  @Get(':id')\n" +
      "  findOne() {}\n" +
      "  @Post()\n" +
      "  create() {}\n" +
      "}\n",
  );
  write(nest, "src/cats/cats.service.ts", "export class CatsService {}\n");
  write(nest, "src/cats/cats.module.ts", "export class CatsModule {}\n");
  write(nest, "src/cats/cat.entity.ts", "export class Cat {}\n");

  const nestResult = await parseRepository(nest);
  check("nest: adapter", nestResult.adapter, "nestjs");
  check(
    "nest: controller role",
    roleOf(nestResult, "src/cats/cats.controller.ts"),
    "controller",
  );
  check("nest: service role", roleOf(nestResult, "src/cats/cats.service.ts"), "service");
  check("nest: module role", roleOf(nestResult, "src/cats/cats.module.ts"), "module");
  check("nest: entity role", roleOf(nestResult, "src/cats/cat.entity.ts"), "entity");
  check("nest: routes", routesOf(nestResult, "src/cats/cats.controller.ts"), [
    "GET /cats",
    "GET /cats/:id",
    "POST /cats",
  ]);

  // --- React on its own: a component and a hook, and no routes. ---
  const react = path.join(root, "react-lib");
  write(react, "package.json", JSON.stringify({ dependencies: { react: "19.3.0" } }));
  write(react, "src/Button.tsx", "export function Button() { return null; }\n");
  write(react, "src/useCounter.ts", "export function useCounter() { return 0; }\n");
  write(react, "src/math.ts", "export const add = (a: number, b: number) => a + b;\n");

  const reactResult = await parseRepository(react);
  check("react: adapter", reactResult.adapter, "react");
  check("react: component role", roleOf(reactResult, "src/Button.tsx"), "component");
  check("react: hook role", roleOf(reactResult, "src/useCounter.ts"), "hook");
  check("react: unclassified role", roleOf(reactResult, "src/math.ts"), "unclassified");
  check("react: no routes", reactResult.routes, []);

  // --- Nothing: a plain TypeScript repository. ---
  const plain = path.join(root, "plain");
  write(plain, "package.json", JSON.stringify({ dependencies: {} }));
  write(plain, "src/index.ts", "export const x = 1;\n");
  write(plain, "src/util.test.ts", "export const y = 2;\n");

  const plainResult = await parseRepository(plain);
  check("plain: adapter", plainResult.adapter, "none");
  check("plain: generic role", roleOf(plainResult, "src/index.ts"), "ts");
  check("plain: generic role (test)", roleOf(plainResult, "src/util.test.ts"), "ts");
  check("plain: no routes", plainResult.routes, []);

  console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failed`);
  if (failures > 0) process.exitCode = 1;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
