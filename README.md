# Weather Bandit

A **fully deterministic, LLM-free** CLI + library that fetches weather
forecasts from the free, no-key [Open-Meteo](https://open-meteo.com/) API,
cross-validates multiple deterministic models, computes ensemble-derived
probabilities, and emits a structured daily "outlook" as Markdown + JSON.

It mirrors the "deterministic offline CLI + publishing template" philosophy of
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

# Structured Outlook as JSON to stdout
weather-bandit outlook Berlin --json

# Write the canonical Markdown + JSON artifact to a directory
weather-bandit export-md Berlin --out ./outlooks
# -> ./outlooks/2026-07-05-berlin.md + ./outlooks/2026-07-05-berlin.json
```

### Commands

```
weather-bandit outlook [city] [--days <n>] [--json]
weather-bandit export-md [city] --out <dir> [--days <n>]
```

| Flag | Description |
|---|---|
| `[city]` | City name; defaults to the first entry of the cities config (`Berlin`) |
| `-d, --days <n>` | Forecast days (default 7; ensemble capped at 16) |
| `--json` | `outlook`: print the structured `Outlook` as JSON instead of Markdown |
| `--out <dir>` | `export-md`: required output directory for the `.md` + `.json` pair |

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

## Development

```sh
pnpm install          # install deps
pnpm -r build         # build both packages
pnpm -r typecheck     # type-check (strict mode)
pnpm -r test          # run all tests

# Run the CLI from source (no build needed, uses tsx):
pnpm dev outlook Berlin
pnpm dev outlook Berlin --json
pnpm dev export-md Berlin --out ./outlooks
```

### Project structure

```
packages/
  core/     @weather-bandit/core — the engine (geocode, fetch, models,
            cross-validate, probability, outlook + Markdown render)
  cli/      weather-bandit — the CLI (thin; all logic in core)
```

## Roadmap

**Done (Phase 0):** engine + CLI — geocoding, three deterministic models,
30-member ensemble probabilities, cross-validation, Markdown + JSON outlook,
`outlook` and `export-md` commands.

**Later:**
- Rain/wind probabilities from the ensemble (currently derived from the
  deterministic models).
- A "my cities" config file (currently a built-in default).
- A history archive of past outlooks.
- Automation / cron publishing.
- A GitHub Pages publishing template + agent skill, in the spirit of
  session-bandit.

## License

MIT