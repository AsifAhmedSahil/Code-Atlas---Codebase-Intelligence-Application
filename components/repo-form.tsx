"use client";

// The dashboard's one job: hand a repository URL to the server and go to the
// analysis it returns. It reports the server's own answer rather than assuming
// success — a URL that is not a github.com repository comes back as an error and
// is shown here; one that is sends the visitor straight to its progress page.

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function RepoForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/analyses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !data.id) {
        setError(data.error ?? "Something went wrong.");
        setPending(false);
        return;
      }
      // The next page claims the run, so the run only begins once there is a
      // page watching it.
      router.push(`/analyses/${data.id}`);
    } catch {
      setError("Could not reach the server.");
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="repo-url" className="text-[13px] text-text">
          Map a public repository
        </label>
        <p className="text-[12px] text-muted">
          Paste a github.com URL. It is read as a public archive — no access to
          your account is requested and nothing is written to it.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="repo-url"
          name="url"
          type="url"
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          disabled={pending}
          placeholder="https://github.com/owner/repo"
          className="h-9 w-full max-w-sm rounded-md border border-border bg-raised px-3 font-mono text-[12px] text-text outline-none transition-colors placeholder:text-muted focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-9 shrink-0 rounded-md bg-accent px-4 text-[13px] font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
        >
          {pending ? "Opening…" : "Map it"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-[12px] text-outgoing">
          {error}
        </p>
      ) : null}
    </form>
  );
}
