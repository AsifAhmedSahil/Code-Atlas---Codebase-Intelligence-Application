import { promises as fs } from "node:fs";
import type {
  Edge,
  EdgeKind,
  FileRole,
  ImportOutcome,
  ImportRecord,
  ParsedFile,
  ParseResult,
  Route,
  SkippedFile,
} from "./types";

// Writing and reading the contract. Reading validates, so "the types hold" is a
// checked fact rather than a hope: a hand-edited or truncated file is rejected
// with a message instead of flowing in as a wrong shape.

export function serializeParseResult(result: ParseResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export async function writeParseResult(
  result: ParseResult,
  filePath: string,
): Promise<void> {
  await fs.writeFile(filePath, serializeParseResult(result), "utf8");
}

export async function readParseResult(filePath: string): Promise<ParseResult> {
  const raw = await fs.readFile(filePath, "utf8");
  const value: unknown = JSON.parse(raw);
  assertParseResult(value);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(`invalid parse result: ${message}`);
}

const EDGE_KINDS: readonly EdgeKind[] = ["import", "re-export", "dynamic"];
const OUTCOMES: readonly ImportOutcome[] = [
  "resolved",
  "outside",
  "excluded",
  "failed",
];

export function assertParseResult(value: unknown): asserts value is ParseResult {
  if (!isRecord(value)) fail("not an object");
  if (value.version !== 1) fail(`unsupported version ${String(value.version)}`);
  if (typeof value.root !== "string") fail("root is not a string");
  if (typeof value.parsedAt !== "string") fail("parsedAt is not a string");
  if (typeof value.adapter !== "string") fail("adapter is not a string");

  if (!isRecord(value.counts)) fail("counts is not an object");
  for (const key of ["found", "parsed", "skipped"] as const) {
    if (typeof value.counts[key] !== "number") {
      fail(`counts.${key} is not a number`);
    }
  }

  if (!Array.isArray(value.files)) fail("files is not an array");
  for (const file of value.files) assertFile(file);
  if (!Array.isArray(value.edges)) fail("edges is not an array");
  for (const edge of value.edges) assertEdge(edge);
  // Absent in results written before roles and routes existed; validated when
  // present so an older file still reads.
  if (value.roles !== undefined) {
    if (!Array.isArray(value.roles)) fail("roles is not an array");
    for (const role of value.roles) assertRole(role);
  }
  if (value.routes !== undefined) {
    if (!Array.isArray(value.routes)) fail("routes is not an array");
    for (const route of value.routes) assertRoute(route);
  }
  if (!Array.isArray(value.skipped)) fail("skipped is not an array");
  for (const skipped of value.skipped) assertSkipped(skipped);
  assertCoverage(value.coverage);
}

function assertFile(value: unknown): asserts value is ParsedFile {
  if (!isRecord(value)) fail("file is not an object");
  for (const key of ["path", "folder", "extension", "hash"] as const) {
    if (typeof value[key] !== "string") fail(`file.${key} is not a string`);
  }
  for (const key of ["bytes", "lines", "fanIn", "fanOut"] as const) {
    if (typeof value[key] !== "number") fail(`file.${key} is not a number`);
  }
  if (typeof value.isModule !== "boolean") fail("file.isModule is not a boolean");
}

function assertEdge(value: unknown): asserts value is Edge {
  if (!isRecord(value)) fail("edge is not an object");
  if (typeof value.source !== "string") fail("edge.source is not a string");
  if (typeof value.target !== "string") fail("edge.target is not a string");
  if (!EDGE_KINDS.includes(value.kind as EdgeKind)) fail("edge.kind is unknown");
}

function assertSkipped(value: unknown): asserts value is SkippedFile {
  if (!isRecord(value)) fail("skipped entry is not an object");
  if (typeof value.path !== "string") fail("skipped.path is not a string");
  if (typeof value.reason !== "string") fail("skipped.reason is not a string");
  if (value.detail !== undefined && typeof value.detail !== "string") {
    fail("skipped.detail is not a string");
  }
}

function assertRole(value: unknown): asserts value is FileRole {
  if (!isRecord(value)) fail("role entry is not an object");
  if (typeof value.path !== "string") fail("role.path is not a string");
  if (typeof value.role !== "string") fail("role.role is not a string");
}

function assertRoute(value: unknown): asserts value is Route {
  if (!isRecord(value)) fail("route entry is not an object");
  if (typeof value.framework !== "string") fail("route.framework is not a string");
  if (value.kind !== "page" && value.kind !== "api") fail("route.kind is unknown");
  if (typeof value.path !== "string") fail("route.path is not a string");
  if (typeof value.file !== "string") fail("route.file is not a string");
  if (value.method !== null && typeof value.method !== "string") {
    fail("route.method is not a string or null");
  }
}

function assertImportRecord(value: unknown): asserts value is ImportRecord {
  if (!isRecord(value)) fail("import record is not an object");
  if (typeof value.from !== "string") fail("import record.from is not a string");
  if (typeof value.line !== "number") fail("import record.line is not a number");
  if (!EDGE_KINDS.includes(value.kind as EdgeKind)) fail("import record.kind is unknown");
  if (!OUTCOMES.includes(value.outcome as ImportOutcome)) {
    fail("import record.outcome is unknown");
  }
  if (value.specifier !== undefined && typeof value.specifier !== "string") {
    fail("import record.specifier is not a string");
  }
  if (value.target !== undefined && typeof value.target !== "string") {
    fail("import record.target is not a string");
  }
  if (value.reason !== undefined && typeof value.reason !== "string") {
    fail("import record.reason is not a string");
  }
}

function assertCoverage(value: unknown): void {
  if (!isRecord(value)) fail("coverage is not an object");
  for (const key of [
    "importsSeen",
    "resolved",
    "outside",
    "excluded",
    "failed",
    "reExportsFound",
    "reExportsResolved",
  ] as const) {
    if (typeof value[key] !== "number") fail(`coverage.${key} is not a number`);
  }
  // Absent in results written before `externalUnresolved` existed; validated
  // when present so an older file still reads.
  if (
    value.externalUnresolved !== undefined &&
    typeof value.externalUnresolved !== "number"
  ) {
    fail("coverage.externalUnresolved is not a number");
  }
  if (!isRecord(value.byKind)) fail("coverage.byKind is not an object");
  for (const kind of EDGE_KINDS) {
    if (typeof value.byKind[kind] !== "number") {
      fail(`coverage.byKind.${kind} is not a number`);
    }
  }
  if (!Array.isArray(value.failures)) fail("coverage.failures is not an array");
  for (const failure of value.failures) assertImportRecord(failure);
  if (!isRecord(value.examples)) fail("coverage.examples is not an object");
  for (const group of ["outside", "excluded"] as const) {
    if (!Array.isArray(value.examples[group])) {
      fail(`coverage.examples.${group} is not an array`);
    }
    for (const record of value.examples[group]) assertImportRecord(record);
  }
}
