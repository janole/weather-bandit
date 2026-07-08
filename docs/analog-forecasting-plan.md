# Plan: Analog Forecasting Command (`weather-bandit analog`)

**Status:** Proposed — ready to implement after context compaction.
**Created:** 2026-07-08
**Author:** Session hand-off (context was at >150k, user requested a detailed plan doc before compaction).

## What this is

A new first-class CLI command and core module that implements **analog
forecasting** (also called *conditional climatology*): instead of averaging
all 30 baseline years equally, find the past years whose recent weather
**looked most like right now**, and build the target-period outlook from only
those "analog" years. This is more skillful than the raw 30-year mean because
it conditions on the current state of the atmosphere, and it is the natural
extension of the climate-anomaly layer shipped in commit `17fb6c3`.

This was prompted by the user asking:

> "so far, the weather in Blavand / Europe is like this and it fits there X
> historical data years so we only take those instead of all 30 years average?"

— which is exactly the analog-forecasting idea, reinvented independently.

## Prototype already validated

A throwaway prototype at `/tmp/wb-analog.mjs` was run against the live
Open-Meteo archive API and **works**. Results for Blavand (Aug 21 → Sep 3):

- "So far" window: 2026-06-15 → 2026-07-05 (21 days, ERA5 observed, latency OK)
- Top 8 analog years (lowest RMSE of daily max temp vs 2026):
  `2020 (4.01°C), 2019 (4.57), 2003 (4.63), 2009 (4.65), 1992 (4.83),
   2018 (4.97), 2005 (5.33), 2011 (5.40)`
- Conditional vs all-30 outcome:
  - Analog avg high **18.1°C** vs all-30 **17.8°C** (Δ +0.3°C — weak)
  - Analog avg rain/day **4.7 mm** vs all-30 **3.5 mm** (Δ +1.1 mm — **meaningful, ~33% wetter**)
- **Takeaway:** the analog method surfaced a wetter-than-normal late-August
  signal that the raw 30-year mean flattens out.

The prototype proves: (a) the no-key Open-Meteo archive has the data,
(b) the two-request strategy (one for the lookback window across all years,
one for the target window) works and stays under the rate limit,
(c) 2026 recent data is available (ERA5 latency is short enough for a
~3-week-old window), (d) the conditional climatology differs meaningfully
from the unconditional one.

## Honest scientific caveats (must appear in output / docs)

- **Skill is modest.** The atmosphere is chaotic; a cool/wet June does not
  *determine* August. Even the best analog had RMSE ~4°C.
- **This is a *better climatology*, not a forecast.** It is more honest than
  the raw 30-year mean (it shows its evidence), but it is still climatology.
- **Local-point matching only (v1).** We match on the target location's own
  recent weather. The *proper* synoptic version matches large-scale pressure/
  height fields over all of Europe — more skillful but needs gridded
  reanalysis (geopotential/MSLP) that the no-key point API does not serve.
  A "poor man's synoptic" multi-point version is a documented Phase-2 stretch.

## Constraints (inherited from weather-bandit)

- **No API key** — Open-Meteo archive only (`archive-api.open-meteo.com`).
- **No LLM** — fully deterministic.
- **Worldwide** — any lat/lon via geocoding.
- **Baseline period:** 1991–2020 (already a constant in `climate.ts`).
- **Graceful degradation** — if recent/current data is unavailable (ERA5
  latency) or any fetch fails, fall back to the all-30 normal and say so.
- **Mirrors session-bandit conventions** — TS strict
  (`noUncheckedIndexedAccess` on, `exactOptionalPropertyTypes` off), Allman
  braces / 4-space / double-quote eslint, tsup build, vitest, `pnpm run ok`
  quality gate.

## Current repo state (so the next session has ground truth)

- Git `main` at `17fb6c3` (clean, pushed).
- Repo: `/Users/ole/projekte/codex-workspaces/janole/weather-bandit`
- **NOTE:** a sub-agent committed two parallel changes that the main agent
  only discovered mid-session: `bd838c1` (JSON dashboard + briefing markdown
  style) and `af0f35e` (localized briefing dates + geocoder timezone
  metadata). These are on `main`. The `outlook.ts` now supports
  `OutlookMarkdownStyle = "briefing" | "full" | "summary" | "tables"` via a
  `--style <style>` flag on the `outlook` command. The briefing style already
  has a `Cloud` row and a `briefingClimateLine`. **Read the current
  `outlook.ts` before editing** — it is larger than the Phase-0 version.
- Existing core modules: `climate.ts`, `cross-validate.ts`, `fetch.ts`,
  `geocode.ts`, `models.ts`, `outlook.ts`, `probability.ts`, `types.ts`.
- Existing CLI commands: `outlook.ts`, `export-md.ts` (registered in
  `packages/cli/src/index.ts` via `makeOutlookCommand` / `makeExportMdCommand`).
- `fetchClimateNormals(loc, forecastDates)` already exists in `climate.ts`
  and hits `archive-api.open-meteo.com/v1/archive` with one contiguous
  request over the baseline range, grouping by calendar date (MM-DD)
  client-side. **Reuse this same single-request + MM-DD-grouping pattern**
  for the analog fetches.
- Quality gate: `pnpm run ok` = build + typecheck + lint:fix + test.
  Currently **33 tests** (29 core + 4 cli).

## Data-source facts (verified live)

- Archive endpoint: `https://archive-api.open-meteo.com/v1/archive`
- Query: `latitude=..&longitude=..&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
  &daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`
- A contiguous request spanning ~35 years × full year returns ~12–13k daily
  entries (~290 KB, ~4s). We filter client-side by MM-DD to keep only the
  needed calendar days. **One request per window** (lookback + target) keeps
  us under the no-key rate limit. **Do NOT** fire 30 parallel per-year
  requests — that triggers HTTP 429 (verified).
- 2026 recent data IS available in the archive (ERA5 preliminary latency is
  short enough for a window ending ~3 days ago). The implementation must
  still handle the case where the current year has gaps (use whatever days
  are non-null; if too few, fall back to all-30).
- A request range like `start=1991-06-15&end=2026-07-05` correctly includes
  2026 alongside all baseline years in one payload.

---

## Implementation plan

### Phase A — core module `packages/core/src/analog.ts` (pure + fetch)

#### Types (add to `types.ts`)

```ts
/** One candidate analog year and its similarity score to the current year. */
export interface AnalogYear
{
    year: string;          // "2020"
    /** Similarity metric: RMSE of daily max temp over the lookback window (°C). Lower = more similar. */
    rmse: number;
}

/** A per-date conditional normal built from the selected analog years. */
export interface AnalogNormal
{
    /** Target date, e.g. "2026-08-21". */
    date: string;
    /** Mean of the analog years' daily max for this calendar date (°C), or null. */
    analogMax: number | null;
    analogMin: number | null;
    analogPrecip: number | null;
    /** The unconditional all-30 normal for the same date, for side-by-side comparison. */
    allMax: number | null;
    allMin: number | null;
    allPrecip: number | null;
}

/** Complete result of an analog forecast. */
export interface AnalogOutlook
{
    location: Location;
    generatedAt: string;
    /** The calendar window used to characterize "so far". */
    lookbackStart: string;   // ISO date
    lookbackEnd: string;
    /** The year used as the "current" signature (2026 if available, else 2025). */
    currentYear: string;
    /** Number of days of current-year observation actually used (may be < window if gaps). */
    observedDays: number;
    /** Selected analog years, best (lowest RMSE) first. */
    analogs: AnalogYear[];
    /** Per-target-date conditional + unconditional normals. */
    normals: AnalogNormal[];
    /** Two-week (whole-target) aggregates. */
    analogAvgMax: number | null;
    analogAvgPrecip: number | null;
    allAvgMax: number | null;
    allAvgPrecip: number | null;
    /** True if the current-year recent data was insufficient and we fell back. */
    degraded: boolean;
    note?: string;
}
```

#### `analog.ts` functions

1. `fetchWindow(loc, startYear, startMmdd, endYear, endMmdd): Promise<RawDaily>`
   — thin wrapper around the archive fetch (reuse the single-contiguous-request
   + MM-DD filter pattern from `climate.ts`). Returns the raw daily arrays.

2. `groupByYear(times, maxes, mins, precs, mmddStart, mmddEnd): Map<string, {max,min,prec}>`
   — pure function: filter to the MM-DD window, group by year. **Unit-testable.**

3. `similarity(current, candidate): number`
   — RMSE of daily max temp, pairing by index within the window, skipping nulls.
   Pure. **Unit-testable.**

4. `selectAnalogs(scores, k): AnalogYear[]`
   — sort by RMSE ascending, take top k. Pure. **Unit-testable.**

5. `computeNormals(targetByYear, analogYearSet, targetDates): AnalogNormal[]`
   — for each target calendar date, mean over analog years vs mean over all
   baseline years. Pure. **Unit-testable.**

6. `buildAnalogOutlook(city, { from, to, lookbackDays=21, top=8 }): Promise<AnalogOutlook>`
   — the orchestrator:
   - `geocode(city)`
   - compute lookback window: `lookbackEnd = today - 3 days` (buffer for ERA5
     latency), `lookbackStart = lookbackEnd - lookbackDays`.
   - `fetchWindow(loc, 1991, lookbackMmdd, 2026, lookbackMmdd)` — recent window
     for ALL years incl. 2026. (Use the earliest baseline year as start and
     current year as end so 2026 is included.)
   - group by year; pick `currentYear` = 2026 if it has ≥ N non-null days
     (e.g. ≥ 10), else 2025, else degrade.
   - compute similarity of currentYear vs each 1991–2020 year; select top-K.
   - `fetchWindow(loc, 1991, targetMmdd, 2020, targetMmdd)` — target window
     for baseline years.
   - `computeNormals(...)` over the target date range.
   - aggregate two-week means.
   - set `degraded` / `note` when current-year data was insufficient.
   - never throw — on fetch failure, return a degraded outlook with
     `all-*` normals only and a note.

#### Markdown renderer `renderAnalogMarkdown(outlook): string`

A compact, honest table that shows **both** the conditional and unconditional
normal side by side, plus the selected years and their scores. Sections:

```
# Analog outlook — Blåvand, Denmark

Generated: 2026-07-08T...
Lookback: 2026-06-15 → 2026-07-05 (21 days observed)
Baseline: 1991–2020 ERA5
Source: [Open-Meteo](https://open-meteo.com/) archive (ERA5 reanalysis)

## Analog years (most similar to 2026 so far)

| Rank | Year | RMSE °C |
|---|---|---|
| 1 | 2020 | 4.0 |
| 2 | 2019 | 4.6 |
...

## Target window 2026-08-21 → 2026-09-03

| Date | Analog high | All-30 high | Δhigh | Analog rain | All-30 rain | ×rain |
|---|---|---|---|---|---|---|
| 2026-08-21 | 18.8 | 18.7 | +0.1 | 6.9 | 3.9 | 1.8× |
...

## Summary

Analog-based (8 yrs): high 18.1°C, rain/day 4.7mm.
All-30 normal:        high 17.8°C, rain/day 3.5mm.
Difference:           +0.3°C, +1.1mm rain/day (wetter than the unconditional normal).

> Skill caveat: this is a conditioned climatology, not a forecast. Even the
> best analog (2020) was 4.0°C off on average over the lookback window. The
> atmosphere is chaotic — use this as a sharper-than-average seasonal guide,
> and re-run a real forecast once the target is within 16 days.
```

Also export `OutlookMarkdownStyle`-style support? No — keep `analog` as its
own command with its own renderer. Do **not** overload `renderOutlookMarkdown`.

### Phase B — CLI command `packages/cli/src/commands/analog.ts`

```
weather-bandit analog [city] --from <YYYY-MM-DD> --to <YYYY-MM-DD>
                        [--lookback <days>] [--top <n>] [--json]
```

- `[city]` — defaults to `DEFAULT_CITIES[0]` (Berlin), same as `outlook`.
- `--from` / `--to` — required target date range (the future period of
  interest). Must be `from <= to`.
- `--lookback <days>` — lookback window length in days (default 21).
- `--top <n>` — number of analog years to select (default 8).
- `--json` — print the structured `AnalogOutlook` as JSON.
- Default output: `renderAnalogMarkdown(outlook)`.

Register in `packages/cli/src/index.ts`:
```ts
import { makeAnalogCommand } from "./commands/analog.js";
program.addCommand(makeAnalogCommand());
```

Mirror the structure of `outlook.ts` (resolveCity, validate `--days` →
validate `--from/--to` and `--lookback/--top`, try/catch with
`process.exitCode = 1`).

### Phase C — exports + tests

- `packages/core/src/index.ts`: export `buildAnalogOutlook`,
  `renderAnalogMarkdown`, `AnalogOutlook`, `AnalogNormal`, `AnalogYear`.
- `packages/cli/test/commands.test.ts`: add a test that the `analog` command
  exists and has the expected args/options (mirror the existing
  `outlook`/`export-md` structure tests). **Do not** hit the network in unit
  tests.
- `packages/core/test/analog.test.ts`: unit-test the **pure** functions
  (`groupByYear`, `similarity`, `selectAnalogs`, `computeNormals`) with small
  fixtures — no network. Use `vi.stubGlobal("fetch", ...)` for one or two
  integration tests of `buildAnalogOutlook` (mock the archive response), like
  the existing `climate.test.ts` does. Cover:
  - similarity ranking (RMSE correctness, null skipping)
  - analog selection (top-K, sorted)
  - conditional vs unconditional normal computation
  - year-crossing MM-DD window (e.g. a lookback spanning Dec→Jan)
  - graceful degradation when current-year data is sparse/absent
  - graceful degradation on fetch failure

### Phase D — docs

- Update `README.md`: add `analog` to the CLI usage + commands table, add a
  short "Analog forecasting" section explaining conditional climatology +
  the skill caveat, add to the Roadmap as done.
- Update `skill/SKILL.md`: document the `analog` command and when to use it
  (target beyond the 16-day forecast horizon; "what's it usually like given
  how the season has gone so far"). Add the skill-caveat boilerplate so
  agents repeat it in published output.
- Update the GitHub Pages template? **No** for v1 — analog output is its own
  Markdown artifact; if later we want to publish analog outlooks, add a
  second layout. Keep the template untouched per the user's earlier instruction
  ("add it to the markup only, i.e. ignore the output for github pages for now").

### Phase E — stretch (do NOT attempt in v1 unless user asks)

- **Multi-point "poor man's synoptic" matching**: sample 4–6 points across
  Europe (e.g. Blavand, Berlin, Lisbon, Warsaw, Trondheim, Marseille), fetch
  the lookback window for each, build a combined feature vector per year, and
  match on that. More skillful (captures the *pattern*, not just local temp),
  more API calls (6× the lookback fetches — must be sequential or throttled
  to avoid 429). Document as a follow-up.
- **Precipitation-inclusive similarity metric**: combine temp RMSE with a
  rain component (e.g. normalized rain RMSE or a pattern correlation).
- **Ensemble-of-analogs**: instead of a hard top-K cut, weight analog years
  by similarity (e.g. inverse-RMSE weights) for a smoother conditional mean.
- **Teleconnection indices (NAO/AO/ENSO)**: fetch from NOAA (some no-key) and
  match on indices rather than local weather. Different data source, more
  classical seasonal-forecasting approach.

## Acceptance criteria

1. `weather-bandit analog Blavand --from 2026-08-21 --to 2026-09-03` runs
   against the live API and prints a Markdown table showing analog years
   (with RMSE), per-date analog-vs-all-30 normals, and two-week aggregates.
2. `--json` prints a valid `AnalogOutlook`.
3. When current-year recent data is unavailable, output degrades to all-30
   normals with a visible note (no crash).
4. When a fetch fails/times out, output degrades gracefully (no crash).
5. `pnpm run ok` is fully green (build + typecheck + lint:fix + all tests).
6. Pure functions are unit-tested without network; the orchestrator has
   mocked-fetch integration tests.
7. README + SKILL.md document the command and the skill caveat.
8. No API key used; only `archive-api.open-meteo.com`; worldwide via geocode.

## Suggested execution order

1. `types.ts` — add the 4 types.
2. `analog.ts` — pure helpers first + tests, then the fetch + orchestrator.
3. `analog.test.ts` — pure-function tests first (get the math right), then
   mocked-fetch integration tests.
4. `renderAnalogMarkdown` + export from `index.ts`.
5. `packages/cli/src/commands/analog.ts` + register in `index.ts` + CLI
   structure test.
6. Run `pnpm run ok`, then live `weather-bandit analog Blavand --from ...`.
7. README + SKILL.md docs.
8. Commit + push.

## Key gotchas for the next session

- **`noUncheckedIndexedAccess` is ON.** Every `arr[i]` is `T | undefined`.
  Guard with `const x = arr[i]; if (!x) continue;` or `arr[i] ?? null`. This
  bit the climate.ts implementation three times — learn from it.
- **Do not fire 30 parallel per-year requests** → HTTP 429. Use the
  single-contiguous-request + client-side MM-DD filter pattern from `climate.ts`.
- **The patch tool mangles backslashes in regex/string literals** — verify
  any `replace(/\\/g, ...)` style code after patching by reading it back.
  Prefer writing whole files with `fs_write` for complex functions.
- **`outlook.ts` is now large and has briefing/summary/tables styles + a
  `briefingClimateLine`** — read it before editing. Do not assume the
  Phase-0 structure.
- **A sub-agent committed parallel work** (`bd838c1`, `af0f35e`) — always
  `git log` + read current files before editing; the working tree may have
  evolved.
- Allman braces, 4-space indent, double quotes, trailing commas — match the
  existing style or eslint will flag it.