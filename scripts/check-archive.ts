// Acceptance check for archive extraction. Builds tar/tar.gz archives in memory
// — including the symbolic links a git archive legitimately contains, path
// traversal attempts, and Windows-hostile names — and asserts how the
// extractor treats each. Not part of the shipped app: run with `npx tsx`.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { extractArchive, type ExtractionResult } from "../lib/pipeline/archive";
import { parseTar } from "../lib/pipeline/tar";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "ok  " : "FAIL"}  ${label}  ->  ${JSON.stringify(actual)}` +
      (ok ? "" : `  (expected ${JSON.stringify(expected)})`),
  );
}

const temporaryDirectories: string[] = [];
function newBase(): string {
  const base = mkdtempSync(path.join(tmpdir(), "check-archive-"));
  temporaryDirectories.push(base);
  return base;
}

function padOctal(value: number, digits: number): string {
  return value.toString(8).padStart(digits, "0") + "\0";
}

function tarHeader(name: string, size: number, typeflag: string, linkname = ""): Buffer {
  const header = Buffer.alloc(512, 0);
  Buffer.from(name, "utf8").copy(header, 0, 0, 100);
  header.write(padOctal(0o644, 7), 100, "ascii");
  header.write(padOctal(0, 7), 108, "ascii");
  header.write(padOctal(0, 7), 116, "ascii");
  header.write(padOctal(size, 11), 124, "ascii");
  header.write(padOctal(0, 11), 136, "ascii");
  header.write("        ", 148, 8, "ascii");
  header.write(typeflag, 156, 1, "ascii");
  Buffer.from(linkname, "utf8").copy(header, 157, 0, 100);
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return header;
}

function block(name: string, content: string, typeflag: string, linkname = ""): Buffer {
  const body = Buffer.from(content, "utf8");
  const padding = (512 - (body.length % 512)) % 512;
  return Buffer.concat([tarHeader(name, body.length, typeflag, linkname), body, Buffer.alloc(padding)]);
}

function paxRecord(key: string, value: string): string {
  const text = `${key}=${value}\n`;
  let size = Buffer.byteLength(text) + 3;
  for (;;) {
    const record = `${size} ${text}`;
    if (Buffer.byteLength(record) === size) return record;
    size = Buffer.byteLength(record);
  }
}

function paxBlock(records: Record<string, string>, typeflag: "x" | "g"): Buffer {
  const content = Object.entries(records)
    .map(([key, value]) => paxRecord(key, value))
    .join("");
  return block("PaxHeaders/entry", content, typeflag);
}

function buildTar(parts: Buffer[]): Buffer {
  return Buffer.concat([...parts, Buffer.alloc(1024)]);
}

async function extract(parts: Buffer[]): Promise<{ dir: string; result: ExtractionResult }> {
  const base = newBase();
  const archive = path.join(base, "repository.tar.gz");
  writeFileSync(archive, gzipSync(buildTar(parts)));
  const dir = path.join(base, "extracted");
  const result = await extractArchive(archive, dir);
  return { dir, result };
}

async function reject(parts: Buffer[]): Promise<{ message: string; base: string; dir: string }> {
  const base = newBase();
  const archive = path.join(base, "repository.tar.gz");
  writeFileSync(archive, gzipSync(buildTar(parts)));
  const dir = path.join(base, "extracted");
  try {
    await extractArchive(archive, dir);
    return { message: "", base, dir };
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error), base, dir };
  }
}

function skipSummary(result: ExtractionResult): string[] {
  return result.skipped.map((entry) => `${entry.path}|${entry.reason}`).sort();
}

function read(dir: string, relative: string): string {
  return readFileSync(path.join(dir, ...relative.split("/")), "utf8");
}

async function main(): Promise<void> {
  try {
    // A normal repository archive extracts files and directories untouched.
    const normal = await extract([
      block("repo-main/", "", "5"),
      block("repo-main/index.ts", "export const a = 1;", "0"),
      block("repo-main/src/", "", "5"),
      block("repo-main/src/b.ts", "export const b = 2;", "0"),
    ]);
    check("normal: files", normal.result.files, 2);
    check("normal: directories", normal.result.directories, 2);
    check("normal: nothing skipped", skipSummary(normal.result), []);
    check("normal: content", read(normal.dir, "repo-main/index.ts"), "export const a = 1;");

    // The reported failure: GitHub's archive for a repo whose `.claude/skills`
    // entries are symbolic links. Extraction must succeed, skipping the links.
    const github = await extract([
      paxBlock({ comment: "0000000000000000000000000000000000000000" }, "g"),
      block("atelier-store-HEAD/", "", "5"),
      block("atelier-store-HEAD/.claude/", "", "5"),
      block("atelier-store-HEAD/.claude/settings.json", "{}", "0"),
      block("atelier-store-HEAD/.claude/skills/", "", "5"),
      block(
        "atelier-store-HEAD/.claude/skills/better-auth-best-practices",
        "",
        "2",
        "../../.agents/skills/better-auth-best-practices",
      ),
      block(
        "atelier-store-HEAD/.claude/skills/create-auth",
        "",
        "2",
        "../../.agents/skills/create-auth",
      ),
      block("atelier-store-HEAD/package.json", '{"dependencies":{"next":"15.0.0"}}', "0"),
    ]);
    check("github: does not fail", github.result.files, 2);
    check("github: symlinks skipped", skipSummary(github.result), [
      "atelier-store-HEAD/.claude/skills/better-auth-best-practices|symbolic-link",
      "atelier-store-HEAD/.claude/skills/create-auth|symbolic-link",
    ]);
    check(
      "github: symlink not created",
      existsSync(path.join(github.dir, "atelier-store-HEAD/.claude/skills/better-auth-best-practices")),
      false,
    );
    check("github: regular file kept", existsSync(path.join(github.dir, "atelier-store-HEAD/.claude/settings.json")), true);

    // Path traversal and absolute paths are rejected before anything is written.
    const traversal = await reject([block("../escape.ts", "nope", "0")]);
    check("traversal: rejected", traversal.message.includes("../escape.ts"), true);
    check("traversal: nothing escaped", existsSync(path.join(traversal.base, "escape.ts")), false);
    check("traversal: extraction dir cleaned", existsSync(traversal.dir), false);

    check("absolute posix: rejected", (await reject([block("/tmp/evil.ts", "", "0")])).message.includes("/tmp/evil.ts"), true);
    check("absolute windows: rejected", (await reject([block("C:\\Windows\\evil.ts", "", "0")])).message.includes("C:\\Windows\\evil.ts"), true);
    check("unc: rejected", (await reject([block("\\\\server\\share\\evil.ts", "", "0")])).message.includes("share"), true);

    // Windows-impossible names are skipped, not fatal, and recorded.
    const windows = await extract([
      block("root/CON", "nope", "0"),
      block("root/nul.txt", "nope", "0"),
      block("root/we:ird.ts", "nope", "0"),
      block("root/foo.", "nope", "0"),
      block("root/bar ", "nope", "0"),
      block("root\\sub\\kept.ts", "export const kept = 1;", "0"),
    ]);
    check("windows: skipped names", skipSummary(windows.result), [
      "root/CON|windows-reserved-name",
      "root/bar |windows-trailing-dot-or-space",
      "root/foo.|windows-trailing-dot-or-space",
      "root/nul.txt|windows-reserved-name",
      "root/we:ird.ts|windows-illegal-character",
    ]);
    check("windows: backslash path written", read(windows.dir, "root/sub/kept.ts"), "export const kept = 1;");

    // PAX extended headers carry the long paths modern git archives use.
    const longName = `repo-main/${"deep-".repeat(30)}file.ts`;
    const pax = await extract([
      paxBlock({ path: longName }, "x"),
      block(longName.slice(0, 100), "export const deep = true;", "0"),
    ]);
    check("pax: long path written", read(pax.dir, longName), "export const deep = true;");

    // A truncated archive is reported, not silently truncated.
    const truncated = buildTar([block("root/big.ts", "x".repeat(2000), "0")]).subarray(0, 700);
    let truncatedThrew = false;
    try {
      parseTar(truncated);
    } catch {
      truncatedThrew = true;
    }
    check("truncated: detected", truncatedThrew, true);

    if (failures > 0) process.exitCode = 1;
    console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failed`);
  } finally {
    for (const directory of temporaryDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
