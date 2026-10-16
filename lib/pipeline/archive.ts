// Unpacking a downloaded repository archive.
//
// GitHub serves a gzipped tarball whose entries we read in-process (see
// `tar.ts`) instead of handing to a platform `tar`. Windows is the reason: the
// git archive for a repository can contain symbolic links — for example
// `.claude/skills/better-auth-best-practices -> ../../.agents/skills/...` — and
// bsdtar cannot create them without elevation, so it aborts the entire
// extraction with `Invalid argument`. Reading the archive ourselves makes the
// step cross-platform and lets us decide, per entry, what may be written.
//
// Policy, applied before anything touches disk:
//   * Entries that could escape the target directory — absolute paths, Windows
//     drive or UNC paths, and `..` traversal — are rejected and the run fails
//     with the offending entry named. Only malformed or hostile archives hit
//     this; a legitimate repository never contains such names.
//   * Non-regular entries — symbolic links, hard links, and device/fifo nodes —
//     are skipped and recorded. They are not source the parser reads, and a
//     link target may point outside the repository. This is what makes the
//     `.claude/skills/*` links harmless instead of fatal.
//   * Names Windows cannot represent (reserved device names, the characters
//     `<>:"|?*`, control characters, or a trailing dot/space) are skipped and
//     recorded rather than failing the run, so one unrepresentable file does
//     not sink an otherwise valid repository.
//   * Everything else is written; the parser's own ignore rules decide what
//     counts as source.

import { promises as fs } from "node:fs";
import path from "node:path";
import { gunzip, type ZlibOptions } from "node:zlib";

import { parseTar, type TarEntry, type TarEntryType } from "./tar";

export type ArchiveSkipReason =
  | "symbolic-link"
  | "hard-link"
  | "special-file"
  | "windows-reserved-name"
  | "windows-illegal-character"
  | "windows-trailing-dot-or-space";

export interface SkippedArchiveEntry {
  path: string;
  reason: ArchiveSkipReason;
}

export interface ExtractionResult {
  files: number;
  directories: number;
  skipped: SkippedArchiveEntry[];
}

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const WINDOWS_ILLEGAL_CHARACTER = /[<>:"|?*\u0000-\u001f]/;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function gunzipBuffer(input: Buffer): Promise<Buffer> {
  const options: ZlibOptions = {};
  return new Promise((resolve, reject) => {
    gunzip(input, options, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

function windowsSkipReason(segment: string): ArchiveSkipReason | null {
  if (WINDOWS_RESERVED_NAME.test(segment)) return "windows-reserved-name";
  if (WINDOWS_ILLEGAL_CHARACTER.test(segment)) return "windows-illegal-character";
  if (/[. ]$/.test(segment)) return "windows-trailing-dot-or-space";
  return null;
}

function linkSkipReason(type: TarEntryType): ArchiveSkipReason {
  if (type === "hardlink") return "hard-link";
  if (type === "special") return "special-file";
  return "symbolic-link";
}

type Plan =
  | { kind: "directory"; absolute: string }
  | { kind: "write"; absolute: string; content: Buffer }
  | { kind: "skip"; path: string; reason: ArchiveSkipReason }
  | { kind: "ignore" }
  | { kind: "reject"; path: string; detail: string };

function planEntry(entry: TarEntry, root: string): Plan {
  const name = entry.name;

  if (name.includes("\0")) return { kind: "reject", path: name, detail: "an unsafe name" };
  if (name.startsWith("/") || name.startsWith("\\")) {
    return { kind: "reject", path: name, detail: "an absolute path" };
  }
  if (/^[A-Za-z]:/.test(name)) {
    return { kind: "reject", path: name, detail: "an absolute Windows (drive) path" };
  }
  if (/^(\\\\|\/\/)/.test(name)) {
    return { kind: "reject", path: name, detail: "a network (UNC) path" };
  }

  const segments: string[] = [];
  for (const segment of name.split(/[\\/]+/)) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      return { kind: "reject", path: name, detail: "a path-traversal entry" };
    }
    const windows = windowsSkipReason(segment);
    if (windows !== null) return { kind: "skip", path: name, reason: windows };
    segments.push(segment);
  }
  if (segments.length === 0) return { kind: "ignore" };

  const absolute = path.resolve(root, ...segments);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (absolute !== root && !absolute.startsWith(prefix)) {
    return { kind: "reject", path: name, detail: "a path that escapes the extraction directory" };
  }

  if (entry.type === "directory") return { kind: "directory", absolute };
  if (entry.type === "file") return { kind: "write", absolute, content: entry.content };
  return { kind: "skip", path: name, reason: linkSkipReason(entry.type) };
}

export async function extractArchive(
  archivePath: string,
  intoDirectory: string,
): Promise<ExtractionResult> {
  const root = path.resolve(intoDirectory);
  await fs.mkdir(root, { recursive: true });

  const failAndCleanup = async (error: unknown): Promise<never> => {
    await fs.rm(root, { recursive: true, force: true });
    throw new Error(`Could not unpack the repository archive: ${messageOf(error)}`);
  };

  let entries: TarEntry[];
  try {
    const archive = await fs.readFile(archivePath);
    entries = parseTar(await gunzipBuffer(archive));
  } catch (error) {
    return failAndCleanup(error);
  }

  const plans = entries.map((entry) => planEntry(entry, root));
  for (const plan of plans) {
    if (plan.kind === "reject") {
      return failAndCleanup(
        `entry "${plan.path}" is ${plan.detail}, so it would escape the extraction directory`,
      );
    }
  }

  const skipped: SkippedArchiveEntry[] = [];
  let directories = 0;
  let files = 0;

  try {
    for (const plan of plans) {
      if (plan.kind !== "directory") continue;
      await fs.mkdir(plan.absolute, { recursive: true });
      directories += 1;
    }
    for (const plan of plans) {
      if (plan.kind !== "write") continue;
      await fs.mkdir(path.dirname(plan.absolute), { recursive: true });
      try {
        await fs.writeFile(plan.absolute, plan.content);
      } catch (error) {
        throw new Error(`could not write entry "${path.basename(plan.absolute)}": ${messageOf(error)}`);
      }
      files += 1;
    }
    for (const plan of plans) {
      if (plan.kind === "skip") skipped.push({ path: plan.path, reason: plan.reason });
    }
  } catch (error) {
    return failAndCleanup(error);
  }

  return { files, directories, skipped };
}

// GitHub wraps everything in one directory; parse from inside it so paths are
// repository-relative rather than `<repo>-<sha>/...`. If there is no single
// wrapper, the extraction directory is the repository.
export async function repositoryRoot(extractionDirectory: string): Promise<string> {
  const entries = await fs.readdir(extractionDirectory, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  if (entries.length === 1 && directories.length === 1) {
    return path.join(extractionDirectory, directories[0].name);
  }
  return extractionDirectory;
}
