# Weather Bandit

A **fully deterministic, LLM-free** CLI + library that fetches weather
forecasts from the free, no-key [Open-Meteo](https://open-meteo.com/) API,
cross-validates multiple deterministic models, computes ensemble-derived
probabilities, and emits a structured daily "outlook" as Markdown + JSON.

It mirrors the "deterministic offline CLI" philosophy of
[session-bandit](https://github.com/janole/session-bandit), but for weather
instead of session transcripts.

No API key. No LLM. No image generation. The tool fetches from Open-Meteo and
renders a reviewable artifact — nothing more.

## v0 scope

- **Variables**: temperature, rain, wind (extensible later).
- **Models cross-validated**: Best-match (DWD ICON for Berlin), GFS, ECMWF.
- **Probabilities**: a 30-member ensemble → per-day P(max ≥ 28/30/32 °C) plus
  p10/p25/p50/p75/p90 percentile bands of the daily-max distribution.
- **Locations**: a "my cities" config, default `["Berlin"]`.
- **No** history archive, automation/cron, or image generation (later phases).

## Install

### As a global CLI (npm)

```sh
npm install -g weather-bandit
```

Requires Node.js 22+.

### From source

```sh
git clone https://github.com/janole/weather-bandit.git
cd weather-bandit
pnpm install
pnpm -r build
npm install -g packages/cli
```

Requires Node.js 22+ and pnpm 10+. The `npm install -g packages/cli` step
installs the CLI globally from the built output (core is bundled into the CLI,
so no separate install needed).

## CLI usage

```sh
# Print a cross-validated outlook for Berlin (default city)
weather-bandit outlook

# Another city
weather-bandit outlook "New York"

# Fewer/more forecast days
weather-bandit outlook Berlin --days 3

# Reusable Markdown variants
weather-bandit outlook Berlin --style briefing
weather-bandit outlook Berlin --style summary
weather-bandit outlook Berlin --style tables

# Structured Outlook as JSON to stdout
weather-bandit outlook Berlin --json

# Analog forecast (conditional climatology) for a target beyond the forecast horizon
weather-bandit analog Blavand --from 2026-08-21 --to 2026-09-03
weather-bandit analog Blavand --from 2026-08-21 --to 2026-09-03 --top 5 --lookback 30
weather-bandit analog Blavand --from 2026-08-21 --to 2026-09-03 --json
```

### Commands

```
weather-bandit outlook [city] [--days <n>] [--json] [--style full|briefing|summary|tables]
weather-bandit analog [city] --from <YYYY-MM-DD> --to <YYYY-MM-DD> [--lookback <days>] [--top <n>] [--json]
```

| Flag | Description |
|---|---|
| `[city]` | City name; defaults to the first entry of the cities config (`Berlin`) |
| `-d, --days <n>` | `outlook`: forecast days (default 7; ensemble capped at 16) |
| `--json` | `outlook`/`analog`: print the structured `Outlook`/`AnalogOutlook` as JSON instead of Markdown |
| `--style <style>` | `outlook`: Markdown style (`full`, `briefing`, `summary`, or `tables`; default `full`) |
| `--from <date>` | `analog`: required target start date (`YYYY-MM-DD`) |
| `--to <date>` | `analog`: required target end date (`YYYY-MM-DD`) |
| `-l, --lookback <days>` | `analog`: lookback window length in days (default 21) |
| `--top <n>` | `analog`: number of analog years to select (default 8) |

The default output is human-readable Markdown: today's hourly table
cross-validated across models (temp, wind, gusts, rain per model side by side),
a multi-day daily summary, ensemble probability bands, cross-validation
findings, and a plain-English summary. `B/G/E` denotes Best-match / GFS /
ECMWF.

## Library usage

`@weather-bandit/core` exposes the engine for programmatic use — no CLI
required.

```ts
import {
  buildOutlook,
  renderOutlookMarkdown,
  geocode,
  fetchDeterministic,
  fetchEnsemble,
  crossValidate,
} from "@weather-bandit/core";

// One call: geocode + 3 deterministic models + 30-member ensemble + summary
const outlook = await buildOutlook("Berlin", 7);
console.log(renderOutlookMarkdown(outlook));

// Or the individual pieces
const loc = await geocode("Berlin");        // { name, latitude, longitude, country }
const models = await fetchDeterministic(loc, 7);  // best-match, gfs, ecmwf
const probs = await fetchEnsemble(loc, 7);  // per-day probability bands
const cv = crossValidate(models);           // { agreements, disagreements }
```

An analog forecast (conditional climatology) is built the same way, from the
ERA5 archive instead of the live forecast API:

```ts
import { buildAnalogOutlook, renderAnalogMarkdown } from "@weather-bandit/core";

// Analog: top-K past years matching the current season, vs the 1991–2020 normal
const analog = await buildAnalogOutlook("Blavand", {
    from: "2026-08-21",
    to: "2026-09-03",
    lookbackDays: 21,
    top: 8,
});
console.log(renderAnalogMarkdown(analog));
```

## How it works

- **Geocoding**: `geocoding-api.open-meteo.com/v1/search` resolves a city name
  to lat/lon.
- **Deterministic**: three endpoints (`/v1/forecast`, `/v1/gfs`, `/v1/ecmwf`)
  are queried with the same hourly + daily variables. ECMWF does not provide
  wind gusts — those values come back as `null` and render as `—`. A model that
  fails is noted and the outlook continues with the remaining models.
- **Ensemble**: `ensemble-api.open-meteo.com/v1/ensemble` is queried **without**
  a `models=` parameter, which returns the default 30-member blend plus the
  mean. (Passing `models=` returns only the mean — a known trap.) For each date,
  each member's hourly temperatures are reduced to a daily max; the
  distribution of 30 daily maxes yields the percentile bands and
  P(max ≥ threshold).

Data © [Open-Meteo](https://open-meteo.com/) — this tool only reads the public,
no-key API and adds cross-validation, probabilities, and rendering on top.

## Analog forecasting (conditional climatology)

The `analog` command answers a question the live forecast can't reach: *given
how the season has gone so far, what's the weather usually like for a target
period beyond the 16-day forecast horizon?* Instead of averaging all 30
baseline years equally, it finds the past years whose recent weather looked
most like right now and builds the target-period outlook from only those
"analog" years.

How it works:

1. **Lookback window.** A window of recent days (default 21, ending 3 days ago
   to allow for ERA5 preliminary-data latency) characterizes "so far" for the
   current year.
2. **Score each baseline year.** Every 1991–2020 baseline year is scored by
   the RMSE of its daily max temperature over the same calendar window versus
   the current year — lower RMSE means a better match.
3. **Select analogs.** The top-K most similar years (default 8) become the
   analog set.
4. **Compare normals.** For the target date range, the conditional normal
   (mean over the analog years) is shown side-by-side with the unconditional
   all-30-year normal.

This can surface signals that the raw 30-year mean flattens out — e.g. a
wetter-than-normal late August for years that started like this one.

> **Honest caveat:** this is a conditioned climatology, not a forecast. Even
> the best analog was a few °C off on average over the lookback window. Use
> it as a sharper-than-average seasonal guide, and re-run a real `outlook`
> forecast once the target is within 16 days.

## Development

```sh
pnpm install          # install deps
pnpm -r build         # build both packages
pnpm -r typecheck     # type-check (strict mode)
pnpm -r test          # run all tests

# Run the CLI from source (no build needed, uses tsx):
pnpm dev outlook Berlin
pnpm dev outlook Berlin --json
pnpm dev analog Blavand --from 2026-08-21 --to 2026-09-03
```

### Project structure

```
packages/
  core/     @weather-bandit/core — the engine (geocode, fetch, models,
            cross-validate, probability, climate normals, analog forecasting,
            outlook + Markdown render)
  cli/      weather-bandit — the CLI (thin; all logic in core)
skill/
  SKILL.md                              agent instructions (CLI usage + tips)
```

## Roadmap

**Done (Phase 0):** engine + CLI — geocoding, three deterministic models,
30-member ensemble probabilities, cross-validation, Markdown + JSON outlook,
`outlook` command.

**Done (Phase 1b): Analog forecasting** — the `analog` command implements
conditional climatology: it scores the 1991–2020 baseline years by how well
their recent weather matches the current season (RMSE of daily max temp over a
lookback window, default 21 days), selects the top-K analog years (default 8),
and compares their target-period normal side-by-side with the unconditional
all-30-year normal. Surfaces signals the raw 30-year mean flattens out; ships
with an honest skill caveat (conditioned climatology, not a forecast).

**Later:**
- Rain/wind probabilities from the ensemble (currently derived from the
  deterministic models).
- A "my cities" config file (currently a built-in default).
- A history archive of past outlooks.
- Automation / cron publishing.

## License

MIT
