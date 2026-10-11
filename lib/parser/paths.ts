import path from "node:path";

// The parser speaks one path dialect so its output is byte-identical on any OS:
// repository-relative, forward slashes, "." meaning the repository root.

export function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

export function parentFolder(relativePath: string): string {
  const slash = relativePath.lastIndexOf("/");
  return slash === -1 ? "." : relativePath.slice(0, slash);
}

// A repository-relative path is inside the repository when it is non-empty, does
// not climb out with "..", and did not come back as an absolute path (which is
// what `path.relative` returns across Windows drives).
export function isInsideRepository(relativePath: string): boolean {
  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
}

export function countLines(content: string): number {
  if (content.length === 0) return 0;
  const parts = content.replace(/\r\n?/g, "\n").split("\n");
  if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  return parts.length;
}
