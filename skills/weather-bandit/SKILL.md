---
name: weather-bandit
description: 'Fetch deterministic, cross-validated weather forecasts from Open-Meteo and print a daily outlook as Markdown + JSON. Use when: (1) You need a weather forecast for a city, (2) You want to cross-check multiple weather models, (3) You want ensemble-derived probabilities (e.g. P(max ≥ 30°C)), (4) You want a conditional-climatology outlook for a target beyond the forecast horizon. Triggers on: "weather forecast", "weather for <city>", "how hot will it be", "rain probability", "weather bandit", "ensemble probability", "cross-validate models", "analog forecast".'
---

## Prerequisites

Weather Bandit is a CLI tool. Try it without installing via `npx`:

```sh
npx weather-bandit --version
```

If `npx` can't find it, install it globally:

```sh
npm install -g weather-bandit
```

If the package is not yet on npm, install from source (requires pnpm 10+):

```sh
git clone https://github.com/janole/weather-bandit.git
cd weather-bandit
pnpm install
pnpm -r build
npm install -g packages/cli
```

Requires Node.js 22+. Building from source additionally requires pnpm 10+.

Verify the installation:

```sh
weather-bandit --version
```

All examples below use the `weather-bandit` command. If you installed via `npx`
only (not global), prefix commands with `npx` instead, e.g.
`npx weather-bandit outlook Berlin`.

## What Weather Bandit does

Weather Bandit fetches forecasts from the free, no-key
[Open-Meteo](https://open-meteo.com/) API, cross-validates three deterministic
models (Best-match / GFS / ECMWF), derives per-day probabilities from a
30-member ensemble, and emits a structured daily "outlook" as Markdown + JSON.
It is fully deterministic and LLM-free — no API calls to an LLM, no auth, no
tracking.

## Output modes

- `outlook` prints human-readable Markdown to the terminal by default. Pass
  `--json` for the structured `Outlook` object.
- `analog` prints a conditional-climatology outlook for a target period beyond
  the forecast horizon. Pass `--json` for the structured `AnalogOutlook` object.

Prefer `outlook` for a quick look in the terminal. Prefer `analog` when the
target period is beyond the 16-day forecast horizon.

## Commands

### Print an outlook to the terminal

```sh
# Default city (Berlin)
weather-bandit outlook

# A specific city
weather-bandit outlook "New York"

# Fewer/more forecast days (ensemble capped at 16)
weather-bandit outlook Berlin --days 3

# Reusable Markdown variants
weather-bandit outlook Berlin --style briefing
weather-bandit outlook Berlin --style summary
weather-bandit outlook Berlin --style tables

# Structured JSON (machine-readable, no Markdown)
weather-bandit outlook Berlin --json
```

### Analog forecast (conditional climatology)

Use `analog` when the target period is beyond the 16-day forecast horizon and
the question is "given how the season has gone so far, what's the weather
usually like for that target period?" Instead of averaging all 30 baseline
years equally, it finds the past years whose recent weather looked most like
right now (by RMSE of daily max temperature over a lookback window, default 21
days ending 3 days ago for ERA5 latency), selects the top-K most similar
years (default 8), and compares their target-period normal side-by-side with
the unconditional 1991–2020 normal.

```sh
# Analog outlook for a target beyond the forecast horizon
weather-bandit analog Blavand --from 2026-08-21 --to 2026-09-03

# Tune the analog set: longer lookback, fewer analog years
weather-bandit analog Blavand --from 2026-08-21 --to 2026-09-03 --lookback 30 --top 5

# Structured AnalogOutlook as JSON
weather-bandit analog Blavand --from 2026-08-21 --to 2026-09-03 --json
```

The output is a standalone Markdown artifact (analog years table, per-date
analog-vs-all-30 normal comparison, summary aggregates, and a skill caveat).
It is **not** a forecast — print it to the terminal or capture it as a plain
Markdown file.

When publishing analog output to a user, **always repeat the skill caveat**
verbatim so the reader does not mistake it for a forecast:

> This is a conditioned climatology, not a forecast. Even the best analog was a
> few °C off on average. Use as a sharper-than-average seasonal guide, and
> re-run a real forecast once the target is within 16 days.

### Flag reference

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

## Tips

- The ensemble is queried **without** a `models=` parameter on purpose — that
  is the only way to get the 30 individual members. Do not "fix" this.
- ECMWF does not provide wind gusts; `windgusts_10m` comes back as `null` and
  renders as `—`. This is expected, not a bug.
- The deterministic models can disagree. The cross-validation section surfaces
  agreements and disagreements; do not suppress disagreements when adding prose.
- `forecastDays` is capped at 16 for the ensemble. Passing a larger value does
  not extend the probability bands.
- The `outlook` command's Markdown has no frontmatter (clean for the
  terminal).
- The tool adds nothing beyond Open-Meteo data plus cross-validation,
  probabilities, and rendering. Do not claim accuracy the data does not
  support; cite Open-Meteo as the source.