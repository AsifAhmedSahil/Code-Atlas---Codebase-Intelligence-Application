// Fetching a public repository as an archive.
//
// No token is used and no repository scope is requested: this only ever talks to
// GitHub's public endpoints for a public repository. The commit is resolved first
// so the run can record exactly which revision it read, and the archive is then
// downloaded at that commit rather than at a moving branch head.

import { writeFile } from "node:fs/promises";

const API_BASE = "https://api.github.com";
const CODELOAD_BASE = "https://codeload.github.com";

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface RemoteRepository extends RepoRef {
  name: string;
  defaultBranch: string;
  commitSha: string;
}

// owner/repo out of any github.com URL. Trailing `.git`, extra path segments
// (`/tree/main/...`) and a trailing slash are all accepted; anything that is not
// a github.com repository URL is refused rather than guessed at.
export function parseRepoUrl(input: string): RepoRef {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("That is not a valid URL.");
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "github.com") {
    throw new Error("Only public github.com repositories are supported.");
  }

  const parts = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (parts.length < 2) {
    throw new Error("That URL is missing an owner or a repository name.");
  }

  const owner = decodeURIComponent(parts[0]);
  const repo = decodeURIComponent(parts[1]).replace(/\.git$/i, "");
  if (!owner || !repo) {
    throw new Error("That URL is missing an owner or a repository name.");
  }
  return { owner, repo };
}

async function githubJson(path: string): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "cartograph",
    },
  });

  if (response.status === 404) {
    throw new Error("No public repository exists at that URL.");
  }
  if (response.status === 403 || response.status === 429) {
    throw new Error("GitHub is rate-limiting requests right now; try again shortly.");
  }
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} while reading the repository.`);
  }
  return response.json();
}

function readString(source: unknown, key: string): string | undefined {
  if (typeof source !== "object" || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

// The default branch and the commit it points at right now.
export async function resolveRepository(ref: RepoRef): Promise<RemoteRepository> {
  const repo = await githubJson(`/repos/${ref.owner}/${ref.repo}`);
  const defaultBranch = readString(repo, "default_branch");
  const name = readString(repo, "name") ?? ref.repo;
  if (!defaultBranch) {
    throw new Error("GitHub did not report a default branch for that repository.");
  }

  const commit = await githubJson(
    `/repos/${ref.owner}/${ref.repo}/commits/${encodeURIComponent(defaultBranch)}`,
  );
  const commitSha = readString(commit, "sha");
  if (!commitSha) {
    throw new Error("GitHub did not report a commit for that repository.");
  }

  return { owner: ref.owner, repo: ref.repo, name, defaultBranch, commitSha };
}

// The archive is the tar of the tree at a specific commit, so what is parsed is
// exactly what `commitSha` names.
export async function downloadArchive(
  repo: RemoteRepository,
  destinationPath: string,
): Promise<void> {
  const url = `${CODELOAD_BASE}/${repo.owner}/${repo.repo}/tar.gz/${repo.commitSha}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "cartograph" },
  });
  if (!response.ok) {
    throw new Error(`Could not download the repository archive (HTTP ${response.status}).`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(destinationPath, bytes);
}
