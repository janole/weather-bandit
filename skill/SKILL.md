---
name: weather-bandit
description: 'Fetch deterministic, cross-validated weather forecasts from Open-Meteo and publish a daily outlook as a Markdown + JSON artifact on GitHub Pages. Use when: (1) You need a weather forecast for a city, (2) You want to cross-check multiple weather models, (3) You want ensemble-derived probabilities (e.g. P(max ≥ 30°C)), (4) You want to publish a daily weather outlook to a GitHub Pages site, (5) You want to generate a weather hero image in a chosen style. Triggers on: "weather forecast", "weather for <city>", "how hot will it be", "rain probability", "publish weather outlook", "weather bandit", "ensemble probability", "cross-validate models".'
---

## Prerequisites

Weather Bandit is a CLI tool that must be installed on the system. Check if it's available:

```sh
command -v weather-bandit
```

If not installed, install it globally:

```sh
npm install -g weather-bandit
```

If the package is not yet on npm, install from source:

```sh
git clone https://github.com/janole/weather-bandit.git
cd weather-bandit
pnpm install
pnpm -r build
npm install -g packages/cli
```

Requires Node.js 22+ and pnpm 10+ (for building from source only; the npm install requires nothing but Node.js).

Verify the installation:

```sh
weather-bandit --version
```

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
- `export-md` writes a **publish-ready** Markdown file (with Jekyll frontmatter
  for the `github-pages-default` template) plus a matching JSON file to a
  directory.

Prefer `outlook` for a quick look in the terminal. Prefer `export-md` when
producing an artifact for a GitHub Pages site.

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

### Export a publish-ready artifact

```sh
weather-bandit export-md Berlin --out outlooks/2026-07-05-berlin
# -> outlooks/2026-07-05-berlin/2026-07-05-berlin.md  (+ frontmatter)
# -> outlooks/2026-07-05-berlin/2026-07-05-berlin.json
```

For a clean permalink, rename the Markdown to `index.md`:

```sh
mv outlooks/2026-07-05-berlin/2026-07-05-berlin.md outlooks/2026-07-05-berlin/index.md
```

| Flag | Description |
|---|---|
| `[city]` | City name; defaults to the first entry of the cities config (`Berlin`) |
| `-d, --days <n>` | Forecast days (default 7; ensemble capped at 16) |
| `--json` | `outlook`: print the structured `Outlook` as JSON instead of Markdown |
| `--style <style>` | `outlook`: Markdown style (`full`, `briefing`, `summary`, or `tables`; default `full`) |
| `--out <dir>` | `export-md`: required output directory for the `.md` + `.json` pair |

## Frontmatter

`export-md` emits Jekyll frontmatter so the Markdown is directly publishable to
the bundled template:

```yaml
---
layout: outlook
title: "Berlin · 2026-07-05"
city: "Berlin"
country: "Germany"
date: 2026-07-05
generatedAt: 2026-07-05T09:58:27.920Z
forecastDays: 7
dataFile: 2026-07-05-berlin.json
heroImage:
---
```

The `dataFile:` field points at the JSON sidecar in the same folder. The
GitHub Pages template uses it to render the animated dashboard while keeping
the Markdown body as the reviewable fallback. The `heroImage:` field is empty
by default. An agent with image generation can fill it in (see below). Agents
without image generation leave it blank — the page renders without an image.

## Publishing a daily outlook

When asked to publish a weather outlook, keep Weather Bandit deterministic.
Use the CLI to create the Markdown + JSON artifact; use your agent judgment
only for city selection, folder layout, the optional hero image, and prose
notes around the artifact.

1. **Build the outlook.** Run `export-md` for the requested city:

   ```sh
   mkdir -p outlooks/2026-07-05-berlin
   weather-bandit export-md Berlin --out outlooks/2026-07-05-berlin
   mv outlooks/2026-07-05-berlin/2026-07-05-berlin.md outlooks/2026-07-05-berlin/index.md
   ```

   Use the date embedded in the generated filename as the folder date. For
   multiple cities, repeat with a per-city subfolder.

2. **Review the artifact.** Open `index.md` and the `.json`. Confirm the
   location resolved correctly, the model tables render, and any
   model-availability note (e.g. ECMWF wind gusts missing) is sensible.

3. **Optionally add a hero image.** If you have image generation, see the
   image catalog below. Save the image next to the outlook (e.g.
   `outlooks/2026-07-05-berlin/hero.jpg`) and set the frontmatter:

   ```yaml
   heroImage: /outlooks/2026-07-05-berlin/hero.jpg
   heroAlt: "Clear sky over Berlin at dawn"
   heroCredit: "Generated with style: photorealistic"
   ```

   If you do not have image generation, leave `heroImage:` empty. Never invent
   an image URL or point at a remote image — the site must stay self-contained
   (no external assets).

4. **Optionally add prose.** You may add a short intro or closing note to the
   Markdown body. Do not alter the generated tables, the probability bands,
   the cross-validation findings, or the summary — those are the deterministic
   artifact. Keep any added prose clearly separate.

5. **Ask before publishing.** Before `git add`, `git commit`, `git push`, or
   any deploy action, summarize what will be published (city, date, whether an
   image is included) and ask for explicit user approval unless the user
   already gave that approval in the current turn.

## Hero image catalog

When the user asks for a hero image, offer the styles below. Each style is a
prompt seed — adapt it to the resolved city, the dominant weather code, and
the time of day. Keep the result as a single landscape image, ~1200×420 or
wider, suitable for the `outlook-hero-image` slot.

Pick the dominant condition from today's weather code in the outlook:
`clear sky`, `mainly clear`, `partly cloudy`, `overcast`, `fog`, `drizzle`,
`rain`, `snow`, `thunderstorm`, etc. Use the *resolved city* for the locale
cue (skyline, landmark, vegetation) — but do not depict identifiable people
or private property.

### Styles

- **photorealistic** — "Photorealistic landscape of {city} under {condition}
  at {time of day}, natural light, 50mm, high detail, no text, no people."
- **comic-book** — "Bold comic-book illustration of {city} in {condition},
  halftone shading, saturated colors, ink outlines, no text."
- **oil-painting** — "Oil painting of {city} in {condition}, impasto brushwork,
  muted palette, golden-hour light, no text."
- **watercolor** — "Soft watercolor of {city} in {condition}, wet-on-wet washes,
  paper texture, restrained palette, no text."
- **linocut** — "High-contrast linocut print of {city} in {condition}, limited
  palette (2–3 inks), carved texture, no text."
- **ukiyo-e** — "Ukiyo-e woodblock print of {city} in {condition}, flat color
  blocks, bold outlines, traditional composition, no text."
- **synthwave** — "Synthwave landscape of {city} in {condition}, neon grid,
  magenta/cyan gradient, retro-futuristic, no text."
- **isometric** — "Isometric vector illustration of {city} in {condition},
  flat shading, clean geometry, data-viz aesthetic, no text."
- **minimalist** — "Minimalist graphic of {city} in {condition}, a few flat
  shapes, two-color palette, lots of negative space, no text."
- **topographic** — "Topographic/map illustration of {region around city} with
  weather symbols for {condition}, contour lines, cartographic palette, no text."

### Rules

- Always include "no text" in the prompt — hero images must not contain
  letters or numbers (the data lives in the tables).
- Always include "no people" unless the user explicitly asks for figures.
- Save the image into the outlook folder and reference it with a root-relative
  `/outlooks/.../hero.<ext>` path in `heroImage`.
- Set `heroAlt` to a short description and `heroCredit` to the style used.
- If image generation is unavailable, skip the image silently and leave
  `heroImage:` empty. Tell the user the outlook is published without an image.

## GitHub Pages template

This skill ships a default publishing template at
`templates/github-pages-default/` next to this `SKILL.md`. Use it when the
user asks for a GitHub Pages site, a polished static outlook page, or a
default public presentation for exported outlooks.

Template behavior:

- It is a Jekyll/GitHub Pages site with custom layouts and CSS.
- It expects generated outlooks at `outlooks/<date>-<city>/index.md`.
- It expects the structured JSON beside the outlook
  (`outlooks/<date>-<city>/<date>-<city>.json`).
- It uses `dataFile` frontmatter to load the JSON sidecar and render an
  animated, JSON-driven dashboard above the canonical Markdown tables.
- For a GitHub Pages project site at `https://<user>.github.io/<repo>/`, set
  `baseurl: "/<repo>"` in `_config.yml` before publishing. Leave `baseurl`
  empty only for a user/org site or a custom domain mounted at `/`.
- It uses `_config.yml` defaults so exported Weather Bandit Markdown gets the
  `outlook` layout automatically.
- It includes a local `.design/outlook-page.html` fixture for layout checks
  without Jekyll or a Pages deploy.
- It is static and self-contained; the only client script is
  `assets/outlook-dashboard.js`, which loads the local JSON sidecar. Do not add
  external assets, trackers, fonts, or remote scripts unless the user
  explicitly asks.
- It exposes a CSS custom-property palette on `:root` in
  `assets/outlook.css` so a downstream stylesheet can retheme it without
  touching the layout markup.

When initializing an empty publishing repo:

```sh
cp -R <skill-directory>/templates/github-pages-default/. <target-repo>/
```

Then, if the target is a normal project repo rather than a user/org Pages site,
edit `_config.yml` and set `baseurl` to the repo path (for example
`baseurl: "/weather-outlook"`).

When the repo already exists, do not overwrite `_config.yml`, `_layouts/`,
`assets/outlook.css`, `index.md`, or `README.md` without asking. Add or update
only `outlooks/<slug>/index.md`, the matching `.json`, and an image if
generated.

For visual template changes, prefer checking
`templates/github-pages-default/.design/outlook-page.html` locally in a
browser before publishing. It is built from plain HTML + the real CSS, so it
does not require Jekyll.

## Multi-city

The default cities config is `["Berlin"]`. To publish outlooks for several
cities, run `export-md` once per city into a per-city subfolder:

```sh
for city in Berlin Hamburg Munich; do
  slug=$(echo "$city" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g')
  dir="outlooks/2026-07-05-$slug"
  mkdir -p "$dir"
  weather-bandit export-md "$city" --out "$dir"
  mv "$dir"/*.md "$dir/index.md"
done
```

The home index lists every published outlook automatically.

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
  terminal). Only `export-md` emits frontmatter. Do not hand-edit the
  frontmatter's deterministic fields (`city`, `date`, `generatedAt`,
  `forecastDays`) — regenerate with `export-md` if they need to change.
- The tool adds nothing beyond Open-Meteo data plus cross-validation,
  probabilities, and rendering. Do not claim accuracy the data does not
  support; cite Open-Meteo as the source.
