# Weather Bandit

Deterministic, LLM-free weather forecasts from the free, no-key
[Open-Meteo](https://open-meteo.com/) API. Cross-validates three deterministic
models, computes ensemble-derived probabilities, and prints a structured daily
outlook as Markdown + JSON.

No API key, no LLM, no network beyond Open-Meteo.

## Install

```sh
npm install -g weather-bandit
```

Requires Node.js 22 or newer.

## Quick Start

```sh
# Print a cross-validated outlook for Berlin (default city)
weather-bandit outlook

# Another city
weather-bandit outlook "New York"

# Structured JSON to stdout
weather-bandit outlook Berlin --json

# Reusable Markdown variants
weather-bandit outlook Berlin --style briefing
weather-bandit outlook Berlin --style summary
weather-bandit outlook Berlin --style tables

# Analog forecast (conditional climatology) for a target beyond the forecast horizon
weather-bandit analog Blavand --from 2026-08-21 --to 2026-09-03
```

## Commands

```text
weather-bandit outlook [city] [--days <n>] [--json] [--style full|briefing|summary|tables]
weather-bandit analog [city] --from <YYYY-MM-DD> --to <YYYY-MM-DD> [--lookback <days>] [--top <n>] [--json]
```

The CLI is thin — all fetching, cross-validation, and rendering live in
`@weather-bandit/core`. The default city is `Berlin`.
