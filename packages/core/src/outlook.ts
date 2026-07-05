import { crossValidate } from "./cross-validate.js";
import { fetchDeterministic, fetchEnsemble } from "./fetch.js";
import { geocode } from "./geocode.js";
import { getModelDef } from "./models.js";
import type { HourlyPoint, Outlook } from "./types.js";

/** Default forecast horizon for the daily outlook (days). */
const DEFAULT_FORECAST_DAYS = 7;

/** Format a value with a unit, tolerating null. */
function fmt(n: number | null | undefined, unit: string): string
{
    return n === null || n === undefined ? "—" : `${Math.round(n * 10) / 10}${unit}`;
}

/** WMO weather code → short plain-English phrase. */
function wmo(code: number | null | undefined): string
{
    if (code === null || code === undefined)
    {
        return "—";
    }
    const map: Record<number, string> = {
        0: "clear sky",
        1: "mainly clear",
        2: "partly cloudy",
        3: "overcast",
        45: "fog",
        48: "depositing rime fog",
        51: "light drizzle",
        53: "moderate drizzle",
        55: "dense drizzle",
        56: "light freezing drizzle",
        57: "dense freezing drizzle",
        61: "slight rain",
        63: "moderate rain",
        65: "heavy rain",
        66: "light freezing rain",
        67: "heavy freezing rain",
        71: "slight snow",
        73: "moderate snow",
        75: "heavy snow",
        77: "snow grains",
        80: "slight rain showers",
        81: "moderate rain showers",
        82: "violent rain showers",
        85: "slight snow showers",
        86: "heavy snow showers",
        95: "thunderstorm",
        96: "thunderstorm with slight hail",
        99: "thunderstorm with heavy hail",
    };
    return map[code] ?? `weather code ${code}`;
}

/** Build the plain-English summary paragraph from the outlook data. */
function buildSummary(loc: string, days: number, models: Outlook["models"], probs: Outlook["probabilities"], cv: { agreements: string[]; disagreements: string[] }): string
{
    const today = models[0]?.daily?.[0];
    const best = models.find((m) => m.model === "best-match") ?? models[0];
    const todayHourly = best?.hourly.filter((h) => h.time.slice(0, 10) === today?.date) ?? [];
    const gustMax = maxNotNull(todayHourly.map((h) => h.windgusts));
    const lines: string[] = [];

    if (today)
    {
        const sky = wmo(today.weatherCode);
        lines.push(
            `${loc}: ${sky}, high ${fmt(today.tempMax, "°C")}/low ${fmt(today.tempMin, "°C")}, `
            + `rain ${fmt(today.precipSum, "mm")}, wind max ${fmt(today.windMax, "km/h")}`
            + (gustMax !== null ? ` (gusts to ${fmt(gustMax, "km/h")})` : "")
            + ".",
        );
    }

    const errored = models.filter((m) => m.error);
    if (errored.length > 0)
    {
        lines.push(
            `${errored.map((m) => getModelDef(m.model)?.label ?? m.model).join(", ")} unavailable — `
            + "outlook built from the remaining models.",
        );
    }

    if (cv.disagreements.length > 0)
    {
        lines.push(`Models disagree on ${cv.disagreements.length} point(s): ${cv.disagreements.slice(0, 3).join("; ")}.`);
    }
    else if (cv.agreements.length > 0)
    {
        lines.push(`The deterministic models agree across the ${days}-day horizon.`);
    }

    const hot = probs
        .map((p) => ({ date: p.date, p: p.pMax30 }))
        .filter((x) => x.p > 0)
        .sort((a, b) => b.p - a.p)[0];
    if (hot)
    {
        lines.push(
            `Ensemble (30 members): highest P(max ≥ 30°C) is ${Math.round(hot.p * 100)}% on ${hot.date}.`,
        );
    }

    return lines.join(" ");
}

/** Max of non-null numeric values, or null if none. */
function maxNotNull(values: (number | null)[]): number | null
{
    const nums = values.filter((v): v is number => v !== null);
    if (nums.length === 0)
    {
        return null;
    }
    return Math.max(...nums);
}

/**
 * Build a complete {@link Outlook} for a city: geocode, fetch the three
 * deterministic models and the 30-member ensemble, cross-validate, and
 * derive the plain-English summary. A failing model is noted, never fatal.
 */
export async function buildOutlook(cityOrLoc: string, forecastDays: number = DEFAULT_FORECAST_DAYS): Promise<Outlook>
{
    const location = await geocode(cityOrLoc);
    const [models, probabilities] = await Promise.all([
        fetchDeterministic(location, forecastDays),
        fetchEnsemble(location, forecastDays),
    ]);
    const cv = crossValidate(models);
    const summary = buildSummary(location.name, forecastDays, models, probabilities, cv);
    return {
        location,
        generatedAt: new Date().toISOString(),
        forecastDays,
        models,
        probabilities,
        summary,
    };
}

/** Re-export the default forecast horizon so the CLI can reference it. */
export { DEFAULT_FORECAST_DAYS };

// --- Frontmatter (publishing) -----------------------------------------------

/** YAML-escape a string for a frontmatter value. */
function yamlString(s: string): string
{
    // Escape backslashes first, then double quotes, for a YAML double-quoted value.
    return s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

/**
 * Render Jekyll frontmatter for an {@link Outlook}, suitable for the
 * `github-pages-default` template. The `heroImage` field is left empty so an
 * agent with image generation can fill it in; agents without it leave it blank
 * and the layout renders without an image.
 */
export function renderOutlookFrontmatter(outlook: Outlook): string
{
    const { location, generatedAt, forecastDays } = outlook;
    const date = generatedAt.slice(0, 10);
    const title = `${location.name} · ${date}`;
    const lines: string[] = [
        "---",
        "layout: outlook",
        `title: "${yamlString(title)}"`,
        `city: "${yamlString(location.name)}"`,
    ];
    if (location.country)
    {
        lines.push(`country: "${yamlString(location.country)}"`);
    }
    lines.push(
        `date: ${date}`,
        `generatedAt: ${generatedAt}`,
        `forecastDays: ${forecastDays}`,
        "heroImage:",
        "---",
    );
    return lines.join("\n");
}

// --- Markdown rendering ------------------------------------------------------

/** Format a number for a table cell, or `—` for null/missing. */
function cell(n: number | null | undefined, digits = 0): string
{
    if (n === null || n === undefined || Number.isNaN(n))
    {
        return "—";
    }
    const v = digits > 0 ? Math.round(n * 10 ** digits) / 10 ** digits : Math.round(n);
    return v.toString();
}

/** Render today's hourly rows, one per hour, with each model side by side. */
function renderHourlyTable(models: Outlook["models"], date: string): string
{
    const ids = ["best-match", "gfs", "ecmwf"];
    const byId = new Map(models.map((m) => [m.model, m]));
    const times = byId.get("best-match")?.hourly
        .filter((h) => h.time.slice(0, 10) === date)
        .map((h) => h.time) ?? [];
    if (times.length === 0)
    {
        return "_No hourly data available._";
    }
    const header = "| Time | Temp °C (B/G/E) | Wind km/h (B/G/E) | Gusts km/h (B/G/E) | Rain mm (B/G/E) |\n|---|---|---|---|---|";
    const rows = times.map((t) =>
    {
        const hhmm = t.slice(11, 16);
        const triple = (get: (h: HourlyPoint) => number | null, digits = 0) =>
            ids.map((id) =>
            {
                const h = byId.get(id)?.hourly.find((p) => p.time === t);
                return h ? cell(get(h), digits) : "—";
            }).join(" / ");
        return `| ${hhmm} | ${triple((h) => h.temperature, 1)} | ${triple((h) => h.windspeed, 1)} | ${triple((h) => h.windgusts, 1)} | ${triple((h) => h.precipitation, 1)} |`;
    });
    return [header, ...rows].join("\n");
}

/** Render the multi-day daily summary table, each model side by side. */
function renderDailyTable(models: Outlook["models"]): string
{
    const ids = ["best-match", "gfs", "ecmwf"];
    const byId = new Map(models.map((m) => [m.model, m]));
    const dates = byId.get("best-match")?.daily?.map((d) => d.date) ?? [];
    if (dates.length === 0)
    {
        return "_No daily data available._";
    }
    const header = "| Date | T max/min °C (B/G/E) | Rain mm (B/G/E) | Wind max km/h (B/G/E) | Code (B) |\n|---|---|---|---|---|";
    const rows = dates.map((date) =>
    {
        const daily = (id: string) => byId.get(id)?.daily?.find((d) => d.date === date);
        const maxmin = ids.map((id) =>
        {
            const d = daily(id);
            return d ? `${cell(d.tempMax, 1)}/${cell(d.tempMin, 1)}` : "—";
        }).join(" / ");
        const rain = ids.map((id) => cell(daily(id)?.precipSum, 1)).join(" / ");
        const wind = ids.map((id) => cell(daily(id)?.windMax, 1)).join(" / ");
        const code = cell(daily("best-match")?.weatherCode);
        return `| ${date} | ${maxmin} | ${rain} | ${wind} | ${code} |`;
    });
    return [header, ...rows].join("\n");
}

/** Render the ensemble probability bands table. */
function renderProbabilityTable(probs: Outlook["probabilities"]): string
{
    if (probs.length === 0)
    {
        return "_No ensemble data available._";
    }
    const header = "| Date | p10 | p25 | p50 | p75 | p90 | P(≥28) | P(≥30) | P(≥32) |\n|---|---|---|---|---|---|---|---|---|";
    const rows = probs.map((p) =>
        `| ${p.date} | ${cell(p.p10, 1)} | ${cell(p.p25, 1)} | ${cell(p.p50, 1)} | ${cell(p.p75, 1)} | ${cell(p.p90, 1)} | ${Math.round(p.pMax28 * 100)}% | ${Math.round(p.pMax30 * 100)}% | ${Math.round(p.pMax32 * 100)}% |`,
    );
    return [header, ...rows].join("\n");
}

/** Render the cross-validation section as bulleted lists. */
function renderCrossValidation(outlook: Outlook): string
{
    const cv = crossValidate(outlook.models);
    const parts: string[] = [];
    if (cv.agreements.length > 0)
    {
        parts.push("**Agreements:**");
        parts.push(cv.agreements.map((a) => `- ${a}`).join("\n"));
    }
    if (cv.disagreements.length > 0)
    {
        parts.push("**Disagreements:**");
        parts.push(cv.disagreements.map((d) => `- ${d}`).join("\n"));
    }
    if (parts.length === 0)
    {
        return "_No cross-validation findings._";
    }
    return parts.join("\n\n");
}

/** Model availability note (only rendered if a model errored). */
function renderModelNote(outlook: Outlook): string
{
    const failed = outlook.models.filter((m) => m.error);
    if (failed.length === 0)
    {
        return "";
    }
    return failed.map((m) => `- ${getModelDef(m.model)?.label ?? m.model}: ${m.error}`).join("\n");
}

/**
 * Render an {@link Outlook} as canonical Markdown: header, today's hourly
 * cross-validated table, multi-day daily summary, ensemble probability bands,
 * cross-validation findings, and the plain-English summary. B/G/E denotes
 * Best-match / GFS / ECMWF.
 */
export function renderOutlookMarkdown(outlook: Outlook): string
{
    const { location, generatedAt, forecastDays, models, probabilities, summary } = outlook;
    const today = models[0]?.daily?.[0]?.date ?? "";
    const locLabel = location.country ? `${location.name}, ${location.country}` : location.name;
    const note = renderModelNote(outlook);
    const sections = [
        `# Weather Outlook — ${locLabel}`,
        "",
        `Generated: ${generatedAt}  `,
        `Forecast days: ${forecastDays}  `,
        "Models: Best-match / GFS / ECMWF (B/G/E)  ",
        "Source: [Open-Meteo](https://open-meteo.com/) (deterministic + 30-member ensemble)",
        "",
        `## Today — ${today} (hourly, cross-validated)`,
        "",
        renderHourlyTable(models, today),
        "",
        "## Daily summary",
        "",
        renderDailyTable(models),
        "",
        "## Probability bands (ensemble, 30 members)",
        "",
        renderProbabilityTable(probabilities),
        "",
        "## Cross-validation",
        "",
        renderCrossValidation(outlook),
        "",
        "## Summary",
        "",
        summary,
        "",
    ];
    if (note)
    {
        sections.push("## Model availability", "", note, "");
    }
    return sections.join("\n");
}
