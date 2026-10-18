# Phase 11 â€” Evals

**Goal.** Answer quality stops being an opinion and becomes a number.

## Build

- A way for scripts outside the web app to load the same environment.
- **The invented-path check.** Take every path-shaped token in an explanation
  and test it against the exact set of paths the model was shown. Anything else
  was invented. Run it as a live evaluator against real traffic, not only
  against a saved dataset.
- **Role accuracy.** Convention already assigns roles it can be certain of, and
  those files never reach the model in normal operation â€” which makes them a
  held-out set with real ground truth. Hide the role, ask the model, compare.
- **Prompt versions.** The current explanation prompt and a previous one, run
  over the same dataset as two separate experiments, scored side by side.

## Constraints

- The invented-path check is deterministic code, not a model grading a model.
  This is set membership â€” it has an exact answer, and a hallucination detector
  that hallucinates is worth nothing.
- The role dataset holds only files whose conventional role is one the
  classifier is actually allowed to return. Scoring it on questions it's
  forbidden to answer measures nothing.
- The retired prompt lives with the evals, not in the application. Shipping a
  dead prompt so a test can reach it is the test shaping the product.
- The prompt-version comparison does need a model as judge, unavoidably â€”
  "is this specific enough to be useful" has no exact answer. Say that out
  loud rather than presenting the number as harder than it is.

## Acceptance check

1. Run the invented-path check against recent real explanations. It reports a
   score, and any failure it flags can be confirmed by hand in ten seconds.
2. Feed it an explanation with a made-up filename spliced in. It catches it.
3. Run role accuracy. It returns a percentage over a dataset of at least thirty
   files.
4. Two prompt versions sit side by side in the dashboard with scores, and you
   can say which is better **and by how much**.

## Not in this phase

Evaluating the agent â€” it doesn't exist yet.

## Outcomes

Verified against the acceptance check above. The evals read the same environment
as the app (`evals/env.ts`), the same parse result (`lib/pipeline/load`) and the
same prompt limits, which the app now exports (`NEIGHBOUR_LIMIT`,
`CONTENT_LIMIT`, `FILE_LIST_LIMIT`, `EXCERPT_BYTES`).

| # | Acceptance | Outcome | Evidence |
|---|------------|---------|----------|
| 1 | Invented-path check over recent real explanations, with hand-checkable failures | **PASS** | `npx tsx evals/run.ts invented-paths` â€” evaluated 26, skipped 3, **26/26 clean (100%)**, **70/70 tokens matched (100%)**, 0 flagged. The 3 skips are synthetic fixtures in test analysis `20000000-â€¦` (2 subjects absent from the parse result, 1 analysis still `running`), not passing cases. |
| 2 | A spliced, made-up filename is caught | **PASS** | `scripts/check-phase11.ts` (offline: `checkInventedPaths` names the fabricated path; `inventedPathEvaluation` scores 0 and names it) and a live replay against a real explanation (``src/definitely/not-real-file.ts`` â†’ score 0). |
| 3 | Role accuracy returns a percentage over at least thirty files | **PASS** | `npx tsx evals/run.ts role-accuracy` â€” dataset 255 eligible files (minimum 30); scored 200. Accuracy varies slightly per run (classifier is a model): **92.0% (184/200)** and **92.5% (185/200)** observed. Only adapter-assigned, classifier-allowed roles; no duplicate files and no ground-truth leakage into the prompt. |
| 4 | Two prompt versions side by side with scores, and which is better by how much | **PASS (LangSmith)** | `npx tsx evals/run.ts prompt-versions` â€” 30 files, `file/current` 0.980 vs `file/v0` 1.000, difference âˆ’0.020, 0 failed runs. Side-by-side comparison lives in LangSmith, not in the application. |

### Dashboard qualification for acceptance #4

"Side by side in the dashboard" is satisfied by **LangSmith's** experiment
comparison (both experiments on dataset `explanation-file-d4dc27ca`, verified
from stored feedback: 30/30 scored each). **There is no in-app eval UI.** If a
native application dashboard is required, it is **not built** and this criterion
is met only through LangSmith. No in-app dashboard exists and none is claimed.

### LangSmith run-completion evidence

Read from the LangSmith API, not from the compare URL or terminal output. The
dataset `explanation-file-d4dc27ca` holds **30 examples**; every experiment on it
evaluates those same 30.

| Experiment | Runs | Scored | Errored | Mean |
|---|---|---|---|---|
| `file-v1-921cdf73` (completed pair, 10:03Z) | 30 | 30 | 0 | **0.980** |
| `file-v0-2b459ed1` (completed pair, 10:04Z) | 30 | 30 | 0 | **1.000** |
| `file-v1-e1a42c35` (a later run, 11:09Z) | 30 | 30 | 0 | **0.980** |

- The comparison numbers come from the **completed pair** above: 0.980 vs 1.000,
  **difference âˆ’0.020**, **0 failed runs**, same dataset and same 30 examples.
- A later invocation created `file-v1-e1a42c35` (complete: 30/30, 0 errors,
  0.980 â€” reproducing the v1 score exactly) but **did not create a paired
  `file-v0-*`**, so that individual invocation is **incomplete**. It is reported
  as incomplete rather than assumed complete. Its v1 result confirms the earlier
  v1 mean; it does not change the comparison.

### Judge caveat

The prompt comparison is scored by a model (the app model, temperature 0, 1â€“5
mapped to 0â€“1, unreadable verdicts score nothing). It is an opinion with a number
on it, not ground truth. On 30 samples the 0.020 gap is within noise; the two
prompts are effectively tied. The deterministic, model-free number is the
invented-path check.

## Known limitations

- **Framework names were false positives (fixed).** `Next.js` tokenises as a path
  because `.js` is a treated extension, so an answer naming the framework was
  flagged as invented. Confirmed by hand on the 2 failures in the first
  26-explanation run (92.3% clean, 70/72 tokens); neither was a real
  hallucination. `extractPathTokens` now drops a small, explicitly enumerated set
  of unambiguous product spellings (Next.js, Vue.js, â€¦) before extension checks.
  **Trade-off:** a fabricated path spelled exactly like one of those names would
  not be flagged. Regression tests pin both directions â€” the product name is
  ignored, and genuine fabricated paths (with and without a separator) are still
  caught. Re-run after the fix: **26/26 clean, 70/70 tokens, 0 flagged.**
- **Thin real-traffic sample.** The database held only 2 real explanations; 24
  more were generated through the real explain pipeline
  (`scripts/seed-explanations.ts`, 0 failures) to give the check a representative
  sample. This is additive real traffic, not fabricated output, but it is not the
  same as a large body of organic usage.
- **LangSmith experiments accumulate, and a run can be interrupted.** 27
  experiments share the dataset. A `prompt-versions` invocation that is killed
  after the first `evaluate` leaves a complete `file-v1-*` with no matching
  `file-v0-*`; the pair from a single clean run is what the comparison should be
  read from. Completion must be checked in LangSmith (run/scored/errored counts),
  never inferred from the printed compare URL. The command itself now guards this:
  it reports runs and scored counts for both sides and exits non-zero with
  `RESULT INCOMPLETE` rather than printing a mean for one side against zero for
  the other.

## Commands

All four are read-only against the database. None of them writes an explanation,
a role, or an analysis; `--splice` builds its fixture in memory and discards it.
`analyze` is the only subcommand that writes, and it is not one of these four.

### `pnpm eval:paths`

Runs the invented-path check over the most recent stored explanations. Every
path-shaped token in an answer is tested against the exact set of paths the
prompt showed for that subject; anything else is invented. Prints evaluated and
skipped counts, the clean score, and per-token match rate, then names any flagged
path with its analysis. Read-only, deterministic, no model call.

```
Invented-path check — real stored explanations
  evaluated 26, skipped 3
  score      100.0% clean (26/26)
  tokens     100.0% matched a shown path (70/70)
```

### `pnpm eval:paths --splice`

Deterministic adversarial check. Reads one real explanation, appends a fabricated
filename (default `src/definitely/not-real-file.ts`) in memory, and requires the
detector to name that exact path. Exits non-zero if it does not, so a broken
detector cannot pass as green. Nothing is persisted.

```
Invented-path splice check — deterministic adversarial test
  source      file apps/react-vite/src/features/users/api/update-profile.ts  (analysis d4dc27ca)
  shown       2 path(s) the prompt showed
  fabricated  src/definitely/not-real-file.ts
  invented    src/definitely/not-real-file.ts
  detected    yes
  RESULT      PASS — src/definitely/not-real-file.ts was caught
```

`--fabricated-path <path>` overrides the injected filename, which is how the
failure path is demonstrated without touching data — for example
`--fabricated-path Next.js` is dropped by the product-name filter, so the check
reports `detected no` and exits 1 rather than a false pass.

### `pnpm eval:roles`

Role accuracy over the eligible held-out dataset: adapter-assigned, classifier
allowed roles, minimum thirty files asserted before any prediction is asked for.
Prints the per-analysis breakdown, overall accuracy, per-role buckets, and every
miss. Read-only.

### `pnpm eval:prompts`

Compares the current file prompt and the retired `file/v0` prompt on the same
dataset as two LangSmith experiments, scored by the same usefulness judge. Prints
per-file scores, both means, and their difference, then the runs/scored counts.
The command reports `RESULT complete` only when both experiments produced runs
and both scored at least one file; otherwise it prints `RESULT INCOMPLETE` and
exits non-zero, so a one-sided run is never mistaken for a measured difference.

```
  mean usefulness (model judge, 0-1):
    file/current  1.000
    file/v0       0.993
    difference    +0.007
  runs/scored   file/current 30/30, file/v0 30/30
  RESULT        complete — both experiments ran and scored; the difference above is measured.
```

### Argument forwarding

pnpm forwards arguments after the script name without needing `--`:
`pnpm eval:paths --splice` reaches the entry point as `invented-paths --splice`.
The explicit `--` form is also accepted and reaches the same place, so both
`pnpm eval:paths --splice` and `pnpm eval:paths -- --splice` work. Only
`eval:paths` consumes extra arguments; `eval:roles` and `eval:prompts` take none.

### External requirements

- `.env.local` must define `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`
  (the evals read any organisation's rows through the service-role client).
- `eval:roles` and `eval:prompts` additionally need `OPENAI_API_KEY`; both fail
  loudly without it rather than reporting an empty number.
- `eval:prompts` also needs `LANGSMITH_API_KEY`. It creates or reuses the dataset
  named for the analysis and logs both experiments there. Scores are model
  opinions with a number attached, not measurements of truth.
- `eval:roles` and `eval:prompts` make real model calls over hundreds of files;
  expect them to run for several minutes.
