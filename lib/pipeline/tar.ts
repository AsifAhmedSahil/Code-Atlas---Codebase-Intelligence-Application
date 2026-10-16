// A small, dependency-free tar reader.
//
// GitHub serves repository archives as gzipped tarballs in the POSIX/USTAR
// format, with PAX extended headers for long names. We read them ourselves
// rather than shelling out to a platform `tar`, because the platform tool is
// where Windows breaks: bsdtar refuses to create the symbolic links that git
// archives legitimately contain (for example `.claude/skills/*`), aborting the
// whole extraction with `Invalid argument`. Reading the archive ourselves lets
// the extraction step decide, entry by entry, what is safe to write — and keeps
// the behaviour identical on every platform.
//
// This module is pure: it takes a decompressed tar buffer and returns entries.
// It performs no filesystem access and applies no policy (that is the caller's
// job in `archive.ts`).

const BLOCK = 512;

export type TarEntryType =
  | "file"
  | "directory"
  | "symlink"
  | "hardlink"
  | "special";

export interface TarEntry {
  name: string;
  type: TarEntryType;
  linkName: string | null;
  size: number;
  content: Buffer;
}

function isZeroBlock(block: Buffer): boolean {
  for (const byte of block) {
    if (byte !== 0) return false;
  }
  return true;
}

function readString(field: Buffer): string {
  const end = field.indexOf(0);
  return (end === -1 ? field : field.subarray(0, end)).toString("utf8");
}

// A numeric tar field is either octal text or, for values too large to fit
// (files over 8 GiB), base-256 with the high bit of the first byte set.
function parseNumeric(field: Buffer): number {
  if (field.length > 0 && (field[0] & 0x80) !== 0) {
    let value = field[0] & 0x7f;
    for (let i = 1; i < field.length; i += 1) {
      value = value * 256 + field[i];
    }
    return value;
  }
  const text = field.toString("ascii").replace(/\0.*$/, "").trim();
  if (text === "") return 0;
  const value = Number.parseInt(text, 8);
  return Number.isFinite(value) ? value : 0;
}

// PAX extended headers hold newline-terminated records shaped `"<len> key=value"`,
// where `<len>` counts the whole record including itself and the newline.
function parsePaxRecords(content: Buffer): Map<string, string> {
  const records = new Map<string, string>();
  let offset = 0;
  while (offset < content.length) {
    const space = content.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number.parseInt(content.subarray(offset, space).toString("ascii"), 10);
    if (!Number.isFinite(length) || length <= 0 || offset + length > content.length) {
      break;
    }
    const record = content.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals !== -1) {
      records.set(record.slice(0, equals), record.slice(equals + 1));
    }
    offset += length;
  }
  return records;
}

function typeOf(flag: number): TarEntryType {
  switch (flag) {
    case 0x31: // "1" hard link
      return "hardlink";
    case 0x32: // "2" symbolic link
      return "symlink";
    case 0x35: // "5" directory
      return "directory";
    case 0x30: // "0" regular file
    case 0x00: // "\0" regular file (old format)
    case 0x37: // "7" contiguous file
      return "file";
    default:
      return "special";
  }
}

export function parseTar(data: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];

  let offset = 0;
  let global = new Map<string, string>();
  let pending: Map<string, string> | null = null;
  let pendingName: string | null = null;
  let pendingLink: string | null = null;

  while (offset + BLOCK <= data.length) {
    const header = data.subarray(offset, offset + BLOCK);
    offset += BLOCK;
    if (isZeroBlock(header)) break;

    const flag = header[156];
    const size = parseNumeric(header.subarray(124, 136));
    const contentEnd = offset + size;
    if (contentEnd > data.length) {
      throw new Error("The archive is truncated or corrupt.");
    }
    const content = data.subarray(offset, contentEnd);
    offset = contentEnd + ((BLOCK - (size % BLOCK)) % BLOCK);

    if (flag === 0x78) {
      // "x" extended header for the next entry
      pending = parsePaxRecords(content);
      continue;
    }
    if (flag === 0x67) {
      // "g" global extended header
      global = new Map([...global, ...parsePaxRecords(content)]);
      continue;
    }
    if (flag === 0x4c) {
      // "L" GNU long name for the next entry
      pendingName = readString(content);
      continue;
    }
    if (flag === 0x4b) {
      // "K" GNU long link name for the next entry
      pendingLink = readString(content);
      continue;
    }

    const prefix = readString(header.subarray(345, 500));
    const base = readString(header.subarray(0, 100));
    let name = pendingName ?? (prefix ? `${prefix}/${base}` : base);
    let linkName = pendingLink ?? readString(header.subarray(157, 257));
    let entrySize = size;

    const extended = pending ?? global;
    const paxPath = extended.get("path");
    const paxLink = extended.get("linkpath");
    if (paxPath !== undefined) name = paxPath;
    if (paxLink !== undefined) linkName = paxLink;
    const paxSize = extended.get("size");
    if (paxSize !== undefined) {
      const parsed = Number.parseInt(paxSize, 10);
      if (Number.isFinite(parsed)) entrySize = parsed;
    }

    pending = null;
    pendingName = null;
    pendingLink = null;

    entries.push({
      name,
      type: typeOf(flag),
      linkName: linkName === "" ? null : linkName,
      size: entrySize,
      content,
    });
  }

  return entries;
}
