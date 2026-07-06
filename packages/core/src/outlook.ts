import { fetchClimateNormals } from "./climate.js";
import { crossValidate } from "./cross-validate.js";
import { fetchDeterministic, fetchEnsemble } from "./fetch.js";
import { geocode } from "./geocode.js";
import { getModelDef } from "./models.js";
import type { ClimateNormal, HourlyPoint, Location, Outlook } from "./types.js";

/** Default forecast horizon for the daily outlook (days). */
const DEFAULT_FORECAST_DAYS = 7;

const COUNTRY_LOCALES: Record<string, string> = {
    AT: "en-AT",
    AU: "en-AU",
    CA: "en-CA",
    CH: "en-CH",
    DE: "en-DE",
    ES: "en-ES",
    FR: "en-FR",
    GB: "en-GB",
    IT: "en-IT",
    JP: "en-JP",
    NL: "en-NL",
    US: "en-US",
};

const COUNTRY_NAME_LOCALES: Record<string, string> = {
    Australia: "en-AU",
    Austria: "en-AT",
    Canada: "en-CA",
    France: "en-FR",
    Germany: "en-DE",
    Italy: "en-IT",
    Japan: "en-JP",
    Netherlands: "en-NL",
    Spain: "en-ES",
    Switzerland: "en-CH",
    "United Kingdom": "en-GB",
    "United States": "en-US",
};

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

function localeForLocation(location: Location): string
{
    const countryCode = location.countryCode?.toUpperCase();
    if (countryCode && COUNTRY_LOCALES[countryCode])
    {
        return COUNTRY_LOCALES[countryCode];
    }
    return (location.country && COUNTRY_NAME_LOCALES[location.country]) || "en-US";
}

function formatLocalDate(date: string, location: Location): string
{
    return new Intl.DateTimeFormat(localeForLocation(location), {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
        weekday: "short",
        year: "numeric",
    }).format(new Date(`${date}T12:00:00Z`));
}

function formatLocalGeneratedAt(generatedAt: string, location: Location): string
{
    const formatted = new Intl.DateTimeFormat(localeForLocation(location), {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: location.timezone ?? "UTC",
    }).format(new Date(generatedAt));
    return location.timezone ? `${formatted} (${location.timezone})` : formatted;
}

function localizeDates(text: string, location: Location): string
{
    return text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (date) => formatLocalDate(date, location));
}

/** Build the plain-English summary paragraph from the outlook data. */
function buildSummary(loc: string, days: number, models: Outlook["models"], probs: Outlook["probabilities"], cv: { agreements: string[]; disagreements: string[] }, climate: ClimateNormal[] = []): string
{
    const today = models[0]?.daily?.[0];
    const best = models.find((m) => m.model === "best-match") ?? models[0];
    const todayHourly = best?.hourly.filter((h) => h.time.slice(0, 10) === today?.date) ?? [];
    const gustMax = maxNotNull(todayHourly.map((h) => h.windgusts));
    const lines: string[] = [];

    if (today)
    {
        const sky = wmo(today.weatherCode);
        const cloud = today.cloudCoverMean !== null ? `, cloud ${Math.round(today.cloudCoverMean)}%` : "";
        lines.push(
            `${loc}: ${sky}${cloud}, high ${fmt(today.tempMax, "°C")}/low ${fmt(today.tempMin, "°C")}, `
            + `rain ${fmt(today.precipSum, "mm")}, wind max ${fmt(today.windMax, "km/h")}`
            + (gustMax !== null ? ` (gusts to ${fmt(gustMax, "km/h")})` : "")
            + ".",
        );
    }

    if (today)
    {
        const cn = climate.find((c) => c.date === today.date);
        if (cn && cn.normalMax !== null && today.tempMax !== null)
        {
            const delta = today.tempMax - cn.normalMax;
            const sign = delta > 0 ? "+" : "";
            const cmp = Math.abs(delta) < 1 ? "near the" : delta > 0 ? "above the" : "below the";
            lines.push(
                `Today's high is ${sign}${Math.round(delta * 10) / 10}°C ${cmp} 1991–2020 normal (${fmt(cn.normalMax, "°C")}).`,
            );
        }
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

function modelLabel(id: string): string
{
    return getModelDef(id)?.label ?? id;
}

function modelRun(outlook: Outlook, id: string): Outlook["models"][number] | undefined
{
    return outlook.models.find((m) => m.model === id);
}

function dailyFor(outlook: Outlook, modelId: string, date: string): NonNullable<Outlook["models"][number]["daily"]>[number] | undefined
{
    return modelRun(outlook, modelId)?.daily?.find((d) => d.date === date);
}

function hourlyFor(outlook: Outlook, modelId: string, date: string): HourlyPoint[]
{
    return modelRun(outlook, modelId)?.hourly.filter((h) => h.time.slice(0, 10) === date) ?? [];
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
    // Forecast dates (from the best-match daily series) used to look up climate normals.
    const forecastDates = models.find((m) => m.model === "best-match")?.daily?.map((d) => d.date)
        ?? models[0]?.daily?.map((d) => d.date)
        ?? [];
    const climate = await fetchClimateNormals(location, forecastDates);
    const summary = buildSummary(location.name, forecastDays, models, probabilities, cv, climate);
    return {
        location,
        generatedAt: new Date().toISOString(),
        forecastDays,
        models,
        probabilities,
        climate,
        summary,
    };
}

/** Re-export the default forecast horizon so the CLI can reference it. */
export { DEFAULT_FORECAST_DAYS };

export type OutlookMarkdownStyle = "briefing" | "full" | "summary" | "tables";

interface RenderOutlookMarkdownOptions
{
    style?: OutlookMarkdownStyle;
}

// --- Frontmatter (publishing) -----------------------------------------------

/** YAML-escape a string for a frontmatter value. */
function yamlString(s: string): string
{
    // Escape backslashes first, then double quotes, for a YAML double-quoted value.
    return s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

/** Slugify an outlook location name for generated artifact filenames. */
export function slugifyOutlookLocation(name: string): string
{
    return name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/** Basename shared by the exported Markdown and JSON outlook artifacts. */
export function outlookArtifactBase(outlook: Outlook): string
{
    return `${outlook.generatedAt.slice(0, 10)}-${slugifyOutlookLocation(outlook.location.name)}`;
}

/**
 * Render Jekyll frontmatter for an {@link Outlook}, suitable for the
 * `github-pages-default` template. The `heroImage` field is left empty so an
 * agent with image generation can fill it in; agents without it leave it blank
 * and the layout renders without an image. The `dataFile` field points at the
 * matching JSON sidecar so the template can render richer data-driven modules.
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
        `dataFile: ${outlookArtifactBase(outlook)}.json`,
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
    const header = "| Time | Temp °C (B/G/E) | Cloud % (B/G/E) | Wind km/h (B/G/E) | Gusts km/h (B/G/E) | Rain mm (B/G/E) |\n|---|---|---|---|---|---|";
    const rows = times.map((t) =>
    {
        const hhmm = t.slice(11, 16);
        const triple = (get: (h: HourlyPoint) => number | null, digits = 0) =>
            ids.map((id) =>
            {
                const h = byId.get(id)?.hourly.find((p) => p.time === t);
                return h ? cell(get(h), digits) : "—";
            }).join(" / ");
        return `| ${hhmm} | ${triple((h) => h.temperature, 1)} | ${triple((h) => h.cloudCover)} | ${triple((h) => h.windspeed, 1)} | ${triple((h) => h.windgusts, 1)} | ${triple((h) => h.precipitation, 1)} |`;
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
    const header = "| Date | T max/min °C (B/G/E) | Cloud % (B/G/E) | Rain mm (B/G/E) | Wind max km/h (B/G/E) | Code (B) |\n|---|---|---|---|---|---|";
    const rows = dates.map((date) =>
    {
        const daily = (id: string) => byId.get(id)?.daily?.find((d) => d.date === date);
        const maxmin = ids.map((id) =>
        {
            const d = daily(id);
            return d ? `${cell(d.tempMax, 1)}/${cell(d.tempMin, 1)}` : "—";
        }).join(" / ");
        const cloud = ids.map((id) => cell(daily(id)?.cloudCoverMean)).join(" / ");
        const rain = ids.map((id) => cell(daily(id)?.precipSum, 1)).join(" / ");
        const wind = ids.map((id) => cell(daily(id)?.windMax, 1)).join(" / ");
        const code = cell(daily("best-match")?.weatherCode);
        return `| ${date} | ${maxmin} | ${cloud} | ${rain} | ${wind} | ${code} |`;
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

/** Format a signed temperature anomaly (forecast minus normal), e.g. `+4.1` / `−2.3`. */
function anomaly(forecast: number | null, normal: number | null): string
{
    if (forecast === null || normal === null)
    {
        return "—";
    }
    const d = forecast - normal;
    const sign = d > 0 ? "+" : "";
    return `${sign}${Math.round(d * 10) / 10}`;
}

/** Render the climate-anomaly table comparing each forecast day to the 1991–2020 normal. */
function renderClimateTable(outlook: Outlook): string
{
    const { models, climate } = outlook;
    if (climate.length === 0)
    {
        return "_No climate-normal data available._";
    }
    const best = models.find((m) => m.model === "best-match") ?? models[0];
    const header = "| Date | High °C | Normal high | Δ | Low °C | Normal low | Rain mm | Normal rain | × |\n|---|---|---|---|---|---|---|---|---|";
    const rows = climate.map((c) =>
    {
        const d = best?.daily?.find((x) => x.date === c.date);
        const hi = d?.tempMax ?? null;
        const lo = d?.tempMin ?? null;
        const rain = d?.precipSum ?? null;
        const rainMult = (rain !== null && c.normalPrecip !== null && c.normalPrecip > 0)
            ? `${Math.round((rain / c.normalPrecip) * 10) / 10}×`
            : "—";
        return `| ${c.date} | ${cell(hi, 1)} | ${cell(c.normalMax, 1)} | ${anomaly(hi, c.normalMax)} | ${cell(lo, 1)} | ${cell(c.normalMin, 1)} | ${cell(rain, 1)} | ${cell(c.normalPrecip, 1)} | ${rainMult} |`;
    });
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

const MODEL_ORDER = ["best-match", "gfs", "ecmwf"];

function timeLabel(time: string | undefined): string
{
    return time ? time.slice(11, 16) : "—";
}

function peakHourly(hours: HourlyPoint[], get: (h: HourlyPoint) => number | null): { time?: string; value: number | null }
{
    let best: HourlyPoint | undefined;
    let bestValue: number | null = null;
    for (const h of hours)
    {
        const value = get(h);
        if (value === null)
        {
            continue;
        }
        if (bestValue === null || value > bestValue)
        {
            best = h;
            bestValue = value;
        }
    }
    return { time: best?.time, value: bestValue };
}

function average(values: (number | null)[]): number | null
{
    const nums = values.filter((v): v is number => v !== null);
    if (nums.length === 0)
    {
        return null;
    }
    return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function rainWindow(hours: HourlyPoint[], daily: number | null | undefined): string
{
    const wet = hours.filter((h) => (h.precipitation ?? 0) >= 0.1);
    if (wet.length === 0)
    {
        return daily !== null && daily !== undefined && daily >= 0.1 ? `${cell(daily, 1)}mm total` : "dry";
    }
    const first = wet[0]?.time;
    const last = wet.at(-1)?.time;
    const window = first === last ? timeLabel(first) : `${timeLabel(first)}–${timeLabel(last)}`;
    return `${cell(daily, 1)}mm total, mainly ${window}`;
}

function renderTodayBriefingTable(outlook: Outlook, date: string): string
{
    const labels = MODEL_ORDER.map((id) => modelLabel(id));
    const rows = [
        ["Max temp", (id: string) =>
        {
            const peak = peakHourly(hourlyFor(outlook, id, date), (h) => h.temperature);
            return peak.value === null ? fmt(dailyFor(outlook, id, date)?.tempMax, "°C") : `${fmt(peak.value, "°C")} (${timeLabel(peak.time)})`;
        }],
        ["Min temp", (id: string) => fmt(dailyFor(outlook, id, date)?.tempMin, "°C")],
        ["Rain", (id: string) => rainWindow(hourlyFor(outlook, id, date), dailyFor(outlook, id, date)?.precipSum)],
        ["Wind", (id: string) =>
        {
            const peak = peakHourly(hourlyFor(outlook, id, date), (h) => h.windspeed);
            return peak.value === null ? fmt(dailyFor(outlook, id, date)?.windMax, "km/h") : `${fmt(peak.value, "km/h")} (${timeLabel(peak.time)})`;
        }],
        ["Gusts", (id: string) =>
        {
            const peak = peakHourly(hourlyFor(outlook, id, date), (h) => h.windgusts);
            return peak.value === null ? "—" : `${fmt(peak.value, "km/h")} (${timeLabel(peak.time)})`;
        }],
        ["Cloud", (id: string) => `${fmt(average(hourlyFor(outlook, id, date).map((h) => h.cloudCover)), "%")} average`],
    ] satisfies [string, (id: string) => string][];
    const header = `| | ${labels.join(" | ")} |\n|---|---|---|---|`;
    return [header, ...rows.map(([label, get]) => `| ${label} | ${MODEL_ORDER.map((id) => get(id)).join(" | ")} |`)].join("\n");
}

function renderBriefingProbabilityTable(outlook: Outlook): string
{
    const rows = outlook.probabilities
        .filter((p) => p.pMax28 > 0 || p.pMax30 > 0 || p.pMax32 > 0)
        .slice(0, 7);
    const selected = rows.length > 0 ? rows : outlook.probabilities.slice(0, 7);
    const header = "| Date | P(max ≥ 28°C) | **P(max ≥ 30°C)** | P(≥ 32°C) | p50 (median) | p75 | p90 |\n|---|---:|---:|---:|---:|---:|---:|";
    return [
        header,
        ...selected.map((p) => `| ${formatLocalDate(p.date, outlook.location)} | ${Math.round(p.pMax28 * 100)}% | **${Math.round(p.pMax30 * 100)}%** | ${Math.round(p.pMax32 * 100)}% | ${cell(p.p50, 1)}°C | ${cell(p.p75, 1)}°C | ${cell(p.p90, 1)}°C |`),
    ].join("\n");
}

function renderBriefingCrossCheckTable(outlook: Outlook, dates: string[]): string
{
    const header = `| Model | ${dates.map((d) => `${formatLocalDate(d, outlook.location)} max`).join(" | ")} |\n|---|${dates.map(() => "---:").join("|")}|`;
    const modelRows = MODEL_ORDER.map((id) => `| ${modelLabel(id)} | ${dates.map((d) => fmt(dailyFor(outlook, id, d)?.tempMax, "°C")).join(" | ")} |`);
    const ensemble = `| Ensemble p50 (median) | ${dates.map((d) => fmt(outlook.probabilities.find((p) => p.date === d)?.p50, "°C")).join(" | ")} |`;
    return [header, ...modelRows, ensemble].join("\n");
}

function renderBottomLineBullets(outlook: Outlook): string[]
{
    const localizedSummary = localizeDates(outlook.summary, outlook.location);
    const modelMarker = " Models disagree on ";
    const ensembleMarker = " Ensemble (30 members): ";
    const modelStart = localizedSummary.indexOf(modelMarker);
    const ensembleStart = localizedSummary.indexOf(ensembleMarker);
    const weatherEnd = [modelStart, ensembleStart]
        .filter((i) => i >= 0)
        .sort((a, b) => a - b)[0] ?? localizedSummary.length;
    const weather = localizedSummary.slice(0, weatherEnd).trim();
    const bullets = [`- ${weather}`];

    if (modelStart >= 0)
    {
        const modelEnd = ensembleStart > modelStart ? ensembleStart : localizedSummary.length;
        const modelText = localizedSummary.slice(modelStart + 1, modelEnd).trim();
        const splitAt = modelText.indexOf(": ");
        const lead = splitAt >= 0 ? modelText.slice(0, splitAt) : modelText;
        const rest = splitAt >= 0 ? modelText.slice(splitAt + 2) : "";
        bullets.push(`- ${lead}:`);
        for (const item of rest.split("; ").map((s) => s.trim()).filter(Boolean))
        {
            bullets.push(`  - ${item}`);
        }
    }

    if (ensembleStart >= 0)
    {
        bullets.push(`- Ensemble (30 members): ${localizedSummary.slice(ensembleStart + ensembleMarker.length).trim()}`);
    }

    return bullets;
}

/** A short climate-anomaly line for the briefing, comparing today to the 1991–2020 normal. Empty when no climate data. */
function briefingClimateLine(outlook: Outlook, todayDate: string): string[]
{
    const cn = outlook.climate.find((c) => c.date === todayDate);
    const today = dailyFor(outlook, "best-match", todayDate);
    if (!cn || cn.normalMax === null || !today || today.tempMax === null)
    {
        return [];
    }
    const delta = today.tempMax - cn.normalMax;
    const sign = delta > 0 ? "+" : "";
    const cmp = Math.abs(delta) < 1 ? "near the" : delta > 0 ? "above the" : "below the";
    const precipNote = (cn.normalPrecip !== null && today.precipSum !== null && cn.normalPrecip > 0)
        ? ` Rain is ${Math.round((today.precipSum / cn.normalPrecip) * 10) / 10}× the normal (${fmt(cn.normalPrecip, "mm")}).`
        : "";
    return [
        "",
        `**Climate context:** today's high is ${sign}${Math.round(delta * 10) / 10}°C ${cmp} 1991–2020 normal (${fmt(cn.normalMax, "°C")}).${precipNote}`,
    ];
}

function renderOutlookBriefingMarkdown(outlook: Outlook): string
{
    const todayDate = modelRun(outlook, "best-match")?.daily?.[0]?.date ?? outlook.probabilities[0]?.date ?? "";
    const locLabel = outlook.location.country ? `${outlook.location.name}, ${outlook.location.country}` : outlook.location.name;
    const hot = [...outlook.probabilities].sort((a, b) => b.pMax30 - a.pMax30)[0];
    const focusDates = [...outlook.probabilities]
        .filter((p) => p.pMax28 > 0 || p.pMax30 > 0 || p.pMax32 > 0)
        .slice(0, 3)
        .map((p) => p.date);
    const crossDates = (focusDates.length > 0 ? focusDates : outlook.probabilities.slice(-2).map((p) => p.date)).slice(0, 3);
    const todayDaily = dailyFor(outlook, "best-match", todayDate);
    const hotProbability = Math.round((hot?.pMax30 ?? 0) * 100);
    const warmProbability = Math.round((hot?.pMax28 ?? 0) * 100);
    return [
        `# Weather briefing — ${locLabel}`,
        "",
        `Generated: ${formatLocalGeneratedAt(outlook.generatedAt, outlook.location)}  `,
        `Forecast days: ${outlook.forecastDays}  `,
        "Models: Best-match, GFS, ECMWF  ",
        "Source: [Open-Meteo](https://open-meteo.com/) (deterministic + 30-member ensemble)",
        "",
        `## Today's weather update (${formatLocalDate(todayDate, outlook.location)})`,
        "",
        renderTodayBriefingTable(outlook, todayDate),
        "",
        `So: **${wmo(todayDaily?.weatherCode)}**, high ${fmt(todayDaily?.tempMax, "°C")}/low ${fmt(todayDaily?.tempMin, "°C")}, rain ${fmt(todayDaily?.precipSum, "mm")}, wind max ${fmt(todayDaily?.windMax, "km/h")}.`,
        ...briefingClimateLine(outlook, todayDate),
        "",
        "## Heat probability — ensemble analysis",
        "",
        "The 30-member ensemble is summarized by daily max-temperature percentiles and threshold probabilities:",
        "",
        renderBriefingProbabilityTable(outlook),
        "",
        "### Cross-check against deterministic models",
        "",
        renderBriefingCrossCheckTable(outlook, crossDates),
        "",
        "### My read",
        "",
        `- Highest P(max ≥ 30°C): **${hotProbability}% on ${hot?.date ? formatLocalDate(hot.date, outlook.location) : "—"}**.`,
        `- Warm-day signal on that date: P(max ≥ 28°C) is **${warmProbability}%**, with ensemble median ${fmt(hot?.p50, "°C")} and p90 ${fmt(hot?.p90, "°C")}.`,
        "- Deterministic model disagreement is useful signal, not noise; use the cross-check table to see whether one model is leading or lagging the heat risk.",
        "- Re-check as the target day moves inside the 3–4 day window; the ensemble spread should narrow.",
        "",
        "### Bottom line",
        "",
        ...renderBottomLineBullets(outlook),
        `- Most likely today: ${wmo(todayDaily?.weatherCode)}, high ${fmt(todayDaily?.tempMax, "°C")}, rain ${fmt(todayDaily?.precipSum, "mm")}.`,
        `- Highest heat signal: ${hotProbability}% chance of max ≥ 30°C on ${hot?.date ? formatLocalDate(hot.date, outlook.location) : "—"}.`,
        "",
    ].join("\n");
}

/**
 * Render an {@link Outlook} as canonical Markdown: header, today's hourly
 * cross-validated table, multi-day daily summary, ensemble probability bands,
 * cross-validation findings, and the plain-English summary. B/G/E denotes
 * Best-match / GFS / ECMWF.
 */
export function renderOutlookMarkdown(outlook: Outlook, options: RenderOutlookMarkdownOptions = {}): string
{
    const { location, generatedAt, forecastDays, models, probabilities, summary } = outlook;
    const today = models[0]?.daily?.[0]?.date ?? "";
    const locLabel = location.country ? `${location.name}, ${location.country}` : location.name;
    const note = renderModelNote(outlook);
    const intro = [
        `# Weather Outlook — ${locLabel}`,
        "",
        `Generated: ${generatedAt}  `,
        `Forecast days: ${forecastDays}  `,
        "Models: Best-match / GFS / ECMWF (B/G/E)  ",
        "Source: [Open-Meteo](https://open-meteo.com/) (deterministic + 30-member ensemble)",
        "",
    ];
    const todaySection = [
        `## Today — ${today} (hourly, cross-validated)`,
        "",
        renderHourlyTable(models, today),
        "",
    ];
    const dailySection = [
        "## Daily summary",
        "",
        renderDailyTable(models),
        "",
    ];
    const probabilitySection = [
        "## Probability bands (ensemble, 30 members)",
        "",
        renderProbabilityTable(probabilities),
        "",
    ];
    const climateSection = outlook.climate.length > 0
        ? [
            "## Climate context (vs 1991–2020 normal)",
            "",
            renderClimateTable(outlook),
            "",
        ]
        : [];
    const crossValidationSection = [
        "## Cross-validation",
        "",
        renderCrossValidation(outlook),
        "",
    ];
    const summarySection = [
        "## Summary",
        "",
        summary,
        "",
    ];

    const style = options.style ?? "full";
    let sections: string[];
    if (style === "briefing")
    {
        return renderOutlookBriefingMarkdown(outlook);
    }
    if (style === "summary")
    {
        sections = [
            ...intro,
            ...summarySection,
            ...dailySection,
            ...climateSection,
            ...probabilitySection,
        ];
    }
    else if (style === "tables")
    {
        sections = [
            ...intro,
            ...todaySection,
            ...dailySection,
            ...climateSection,
            ...probabilitySection,
        ];
    }
    else
    {
        sections = [
            ...intro,
            ...todaySection,
            ...dailySection,
            ...climateSection,
            ...probabilitySection,
            ...crossValidationSection,
            ...summarySection,
        ];
    }
    if (note)
    {
        sections.push("## Model availability", "", note, "");
    }
    return sections.join("\n");
}
