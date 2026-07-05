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

# Write the canonical Markdown + JSON artifact to a directory
weather-bandit export-md Berlin --out ./outlooks
```

## Commands

```text
weather-bandit outlook [city] [--days <n>] [--json]
weather-bandit export-md [city] --out <dir> [--days <n>]
```

The CLI is thin — all fetching, cross-validation, and rendering live in
`@weather-bandit/core`. The default city is `Berlin`.