import { CLIMATE_BASELINE_END_YEAR, CLIMATE_BASELINE_LABEL, CLIMATE_BASELINE_START_YEAR } from "./climate.js";
import { geocode } from "./geocode.js";
import type { AnalogNormal, AnalogOutlook, AnalogYear, Location } from "./types.js";

/** Open-Meteo archive (ERA5 reanalysis) base URL for historical data. */
const ARCHIVE_BASE = "https://archive-api.open-meteo.com";

/** Default lookback window length in days (characterizes "so far"). */
export const DEFAULT_LOOKBACK_DAYS = 21;

/** Default number of analog years to select. */
export const DEFAULT_ANALOG_TOP = 8;

/** Buffer days subtracted from today for the lookback end (ERA5 preliminary latency). */
const LOOKBACK_END_BUFFER_DAYS = 3;

/** Minimum non-null observed days required in the current year to not degrade. */
const MIN_OBSERVED_DAYS = 10;

/** Raw daily arrays from the archive (ERA5) response. */
interface RawArchiveDaily
{
    time: string[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    precipitation_sum?: (number | null)[];
}

interface ArchiveResponse
{
    daily?: RawArchiveDaily;
}

/** One day's values for a specific year + calendar date. */
interface DayValues
{
    max: number | null;
    min: number | null;
    precip: number | null;
}

/** A year's worth of daily values keyed by calendar date (MM-DD). */
type YearGroup = Map<string, DayValues>;

// --- pure helpers (unit-tested) --------------------------------------------

/** Arithmetic mean of a non-empty number array, or null if empty. */
function meanOrNull(values: number[]): number | null
{
    if (values.length === 0)
    {
        return null;
    }
    return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Test whether a calendar date (MM-DD) falls within a window. Handles
 * year-crossing windows (e.g. `12-20` → `01-05`): when `startMmdd > endMmdd`,
 * the window wraps around the year boundary.
 */
export function inMmddWindow(mmdd: string, startMmdd: string, endMmdd: string): boolean
{
    if (startMmdd <= endMmdd)
    {
        return mmdd >= startMmdd && mmdd <= endMmdd;
    }
    // Year-crossing: e.g. Dec 20 → Jan 5
    return mmdd >= startMmdd || mmdd <= endMmdd;
}

/**
 * Group raw archive daily arrays by year, keeping only days that fall within
 * the given MM-DD window. Returns a map of year → (MM-DD → values).
 * Pure — no network.
 */
export function groupByYear(
    times: string[],
    maxes: (number | null)[],
    mins: (number | null)[],
    precs: (number | null)[],
    startMmdd: string,
    endMmdd: string,
): Map<string, YearGroup>
{
    const byYear = new Map<string, YearGroup>();
    for (let i = 0; i < times.length; i++)
    {
        const time = times[i];
        if (!time)
        {
            continue;
        }
        const mmdd = time.slice(5);
        if (!inMmddWindow(mmdd, startMmdd, endMmdd))
        {
            continue;
        }
        const year = time.slice(0, 4);
        let group = byYear.get(year);
        if (!group)
        {
            group = new Map();
            byYear.set(year, group);
        }
        group.set(mmdd, {
            max: maxes[i] ?? null,
            min: mins[i] ?? null,
            precip: precs[i] ?? null,
        });
    }
    return byYear;
}

/**
 * Similarity metric: RMSE of daily max temperature between the current year
 * and a candidate year, pairing by calendar date (MM-DD). Only days where
 * both years have non-null max are counted. Returns `Infinity` if there are
 * no overlapping non-null days.
 */
export function similarity(current: YearGroup, candidate: YearGroup): number
{
    let sumSq = 0;
    let count = 0;
    for (const [mmdd, cur] of current)
    {
        if (cur.max === null)
        {
            continue;
        }
        const cand = candidate.get(mmdd);
        if (!cand || cand.max === null)
        {
            continue;
        }
        sumSq += (cur.max - cand.max) ** 2;
        count++;
    }
    return count > 0 ? Math.sqrt(sumSq / count) : Number.POSITIVE_INFINITY;
}

/**
 * Select the top-K analog years (lowest RMSE), sorted best-first.
 * Pure. Returns a new array.
 */
export function selectAnalogs(scores: AnalogYear[], k: number): AnalogYear[]
{
    return [...scores].sort((a, b) => a.rmse - b.rmse).slice(0, k);
}

/**
 * Compute per-target-date conditional (analog) and unconditional (all-baseline)
 * normals. For each target date, the MM-DD is extracted and the mean is taken
 * over the analog-year subset vs the full baseline-year set. Pure.
 */
export function computeNormals(
    targetByYear: Map<string, YearGroup>,
    analogYears: Set<string>,
    targetDates: string[],
): AnalogNormal[]
{
    return targetDates.map((date) =>
    {
        const mmdd = date.slice(5);
        const analogMaxes: number[] = [];
        const analogMins: number[] = [];
        const analogPrecips: number[] = [];
        const allMaxes: number[] = [];
        const allMins: number[] = [];
        const allPrecips: number[] = [];
        for (const [year, group] of targetByYear)
        {
            const dv = group.get(mmdd);
            if (!dv)
            {
                continue;
            }
            const isAnalog = analogYears.has(year);
            if (dv.max !== null)
            {
                allMaxes.push(dv.max);
                if (isAnalog)
                {
                    analogMaxes.push(dv.max);
                }
            }
            if (dv.min !== null)
            {
                allMins.push(dv.min);
                if (isAnalog)
                {
                    analogMins.push(dv.min);
                }
            }
            if (dv.precip !== null)
            {
                allPrecips.push(dv.precip);
                if (isAnalog)
                {
                    analogPrecips.push(dv.precip);
                }
            }
        }
        return {
            date,
            analogMax: meanOrNull(analogMaxes),
            analogMin: meanOrNull(analogMins),
            analogPrecip: meanOrNull(analogPrecips),
            allMax: meanOrNull(allMaxes),
            allMin: meanOrNull(allMins),
            allPrecip: meanOrNull(allPrecips),
        };
    });
}

// --- fetch + orchestration --------------------------------------------------

/**
 * Fetch a daily archive window from ERA5. A single contiguous request from
 * `startYear-startMmdd` to `endYear-endMmdd` is used (the response includes
 * every day in the span; the caller filters client-side by MM-DD). Returns
 * the raw daily arrays, or null on failure (graceful degradation).
 */
async function fetchWindow(
    loc: Location,
    startYear: number,
    startMmdd: string,
    endYear: number,
    endMmdd: string,
): Promise<RawArchiveDaily | null>
{
    const url =
        `${ARCHIVE_BASE}/v1/archive?latitude=${loc.latitude}&longitude=${loc.longitude}`
        + `&start_date=${startYear}-${startMmdd}&end_date=${endYear}-${endMmdd}`
        + "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto";
    try
    {
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok)
        {
            return null;
        }
        const data = (await res.json()) as ArchiveResponse;
        const daily = data.daily;
        if (!daily || !daily.time || daily.time.length === 0)
        {
            return null;
        }
        return daily;
    }
    catch
    {
        return null;
    }
}

/** Count non-null max-temperature days in a year group. */
function observedDayCount(group: YearGroup | undefined): number
{
    if (!group)
    {
        return 0;
    }
    let count = 0;
    for (const dv of group.values())
    {
        if (dv.max !== null)
        {
            count++;
        }
    }
    return count;
}

/** Enumerate all ISO dates from `from` to `to` inclusive (UTC). */
function enumerateDates(from: string, to: string): string[]
{
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    const dates: string[] = [];
    const d = new Date(start);
    while (d <= end)
    {
        dates.push(d.toISOString().slice(0, 10));
        d.setUTCDate(d.getUTCDate() + 1);
    }
    return dates;
}

/** Add `n` days to an ISO date string, returning a new ISO date string. */
function addDays(iso: string, n: number): string
{
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

/** Today's ISO date (UTC). */
function todayIso(): string
{
    return new Date().toISOString().slice(0, 10);
}

/** Options for {@link buildAnalogOutlook}. */
export interface BuildAnalogOutlookOptions
{
    /** Target start date (ISO, `YYYY-MM-DD`). */
    from: string;
    /** Target end date (ISO, `YYYY-MM-DD`). */
    to: string;
    /** Lookback window length in days (default 21). */
    lookbackDays?: number;
    /** Number of analog years to select (default 8). */
    top?: number;
}

/**
 * Build a complete {@link AnalogOutlook}: geocode the city, fetch the recent
 * (lookback) window for all years including the current year, find the
 * baseline years whose recent weather best matches the current year, fetch
 * the target window for the baseline years, and compute conditional vs
 * unconditional normals. Never throws — on fetch failure or insufficient
 * current-year data, returns a degraded outlook with all-30 normals only and
 * a human-readable note.
 */
export async function buildAnalogOutlook(
    city: string,
    options: BuildAnalogOutlookOptions,
): Promise<AnalogOutlook>
{
    const lookbackDays = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const top = options.top ?? DEFAULT_ANALOG_TOP;
    const generatedAt = new Date().toISOString();

    let location: Location;
    try
    {
        location = await geocode(city);
    }
    catch
    {
        // Geocode failure (network/API) — degrade gracefully without a crash.
        return degradedOutlook(
            { name: city, latitude: 0, longitude: 0 },
            generatedAt,
            `Could not geocode "${city}" — the geocoding API is unavailable.`,
        );
    }

    const targetDates = enumerateDates(options.from, options.to);
    if (targetDates.length === 0)
    {
        return degradedOutlook(location, generatedAt, "Invalid target date range.");
    }

    // Lookback window: ends 3 days ago (ERA5 latency buffer), spans lookbackDays.
    const lookbackEnd = addDays(todayIso(), -LOOKBACK_END_BUFFER_DAYS);
    const lookbackStart = addDays(lookbackEnd, -lookbackDays + 1);
    const lookbackStartMmdd = lookbackStart.slice(5);
    const lookbackEndMmdd = lookbackEnd.slice(5);
    const lookbackEndYear = Number.parseInt(lookbackEnd.slice(0, 4), 10);

    // Target MM-DD window (may cross a year boundary).
    const targetStartMmdd = options.from.slice(5);
    const targetEndMmdd = options.to.slice(5);

    // 1. Fetch the lookback window for all years (baseline + current year).
    const lookbackRaw = await fetchWindow(
        location,
        CLIMATE_BASELINE_START_YEAR,
        lookbackStartMmdd,
        lookbackEndYear,
        lookbackEndMmdd,
    );
    if (!lookbackRaw)
    {
        return degradedOutlook(location, generatedAt, "Historical lookback data unavailable from the archive API.");
    }
    const lookbackByYear = groupByYear(
        lookbackRaw.time,
        lookbackRaw.temperature_2m_max ?? [],
        lookbackRaw.temperature_2m_min ?? [],
        lookbackRaw.precipitation_sum ?? [],
        lookbackStartMmdd,
        lookbackEndMmdd,
    );

    // 2. Pick the current-year signature (this year, else last year).
    let currentYear = String(lookbackEndYear);
    let currentGroup = lookbackByYear.get(currentYear);
    let observed = observedDayCount(currentGroup);
    if (observed < MIN_OBSERVED_DAYS)
    {
        currentYear = String(lookbackEndYear - 1);
        currentGroup = lookbackByYear.get(currentYear);
        observed = observedDayCount(currentGroup);
    }

    const base: AnalogOutlook = {
        location,
        generatedAt,
        lookbackStart,
        lookbackEnd,
        currentYear,
        observedDays: observed,
        analogs: [],
        normals: [],
        analogAvgMax: null,
        analogAvgPrecip: null,
        allAvgMax: null,
        allAvgPrecip: null,
        degraded: false,
    };

    if (observed < MIN_OBSERVED_DAYS)
    {
        // Current-year data insufficient — fetch target for all-30 normals only.
        const targetRaw = await fetchWindow(
            location,
            CLIMATE_BASELINE_START_YEAR,
            targetStartMmdd,
            CLIMATE_BASELINE_END_YEAR,
            targetEndMmdd,
        );
        if (!targetRaw)
        {
            return { ...base, degraded: true, note: "Recent and target historical data unavailable; analog forecast not possible." };
        }
        const targetByYear = groupByYear(
            targetRaw.time,
            targetRaw.temperature_2m_max ?? [],
            targetRaw.temperature_2m_min ?? [],
            targetRaw.precipitation_sum ?? [],
            targetStartMmdd,
            targetEndMmdd,
        );
        const normals = computeNormals(targetByYear, new Set(), targetDates);
        return {
            ...base,
            normals,
            allAvgMax: meanOrNull(normals.map((n) => n.allMax).filter((v): v is number => v !== null)),
            allAvgPrecip: meanOrNull(normals.map((n) => n.allPrecip).filter((v): v is number => v !== null)),
            degraded: true,
            note: `Current-year recent data insufficient (only ${observed} day(s) observed in ${currentYear}); showing the unconditional ${CLIMATE_BASELINE_LABEL} normal only.`,
        };
    }

    // 3. Compute similarity of the current year vs each baseline year.
    const scores: AnalogYear[] = [];
    for (const [year, group] of lookbackByYear)
    {
        const yrNum = Number.parseInt(year, 10);
        if (year === currentYear || yrNum < CLIMATE_BASELINE_START_YEAR || yrNum > CLIMATE_BASELINE_END_YEAR)
        {
            continue;
        }
        const rmse = similarity(currentGroup!, group);
        if (Number.isFinite(rmse))
        {
            scores.push({ year, rmse });
        }
    }
    const analogs = selectAnalogs(scores, top);
    const analogYearSet = new Set(analogs.map((a) => a.year));

    // 4. Fetch the target window for baseline years.
    const targetRaw = await fetchWindow(
        location,
        CLIMATE_BASELINE_START_YEAR,
        targetStartMmdd,
        CLIMATE_BASELINE_END_YEAR,
        targetEndMmdd,
    );
    if (!targetRaw)
    {
        return degradedOutlook(location, generatedAt, "Historical target-window data unavailable from the archive API.");
    }
    const targetByYear = groupByYear(
        targetRaw.time,
        targetRaw.temperature_2m_max ?? [],
        targetRaw.temperature_2m_min ?? [],
        targetRaw.precipitation_sum ?? [],
        targetStartMmdd,
        targetEndMmdd,
    );

    // 5. Compute conditional vs unconditional normals.
    const normals = computeNormals(targetByYear, analogYearSet, targetDates);
    const analogAvgMax = meanOrNull(normals.map((n) => n.analogMax).filter((v): v is number => v !== null));
    const analogAvgPrecip = meanOrNull(normals.map((n) => n.analogPrecip).filter((v): v is number => v !== null));
    const allAvgMax = meanOrNull(normals.map((n) => n.allMax).filter((v): v is number => v !== null));
    const allAvgPrecip = meanOrNull(normals.map((n) => n.allPrecip).filter((v): v is number => v !== null));

    return {
        ...base,
        analogs,
        normals,
        analogAvgMax,
        analogAvgPrecip,
        allAvgMax,
        allAvgPrecip,
    };
}

/** Construct a degraded outlook with all-null analog fields and the given note. */
function degradedOutlook(location: Location, generatedAt: string, note: string): AnalogOutlook
{
    return {
        location,
        generatedAt,
        lookbackStart: "",
        lookbackEnd: "",
        currentYear: "",
        observedDays: 0,
        analogs: [],
        normals: [],
        analogAvgMax: null,
        analogAvgPrecip: null,
        allAvgMax: null,
        allAvgPrecip: null,
        degraded: true,
        note,
    };
}

// --- Markdown rendering ------------------------------------------------------

/** Format a number for a table cell, or `—` for null/missing. */
function cell(n: number | null, digits = 1): string
{
    if (n === null || Number.isNaN(n))
    {
        return "—";
    }
    const v = Math.round(n * 10 ** digits) / 10 ** digits;
    return v.toString();
}

/** Format a signed temperature difference, e.g. `+0.3` / `−1.1`. */
function signedDelta(a: number | null, b: number | null): string
{
    if (a === null || b === null)
    {
        return "—";
    }
    const d = a - b;
    const sign = d > 0 ? "+" : "";
    return `${sign}${Math.round(d * 10) / 10}`;
}

/** Format a rain multiplier (analog / all), e.g. `1.8×`, or `—`. */
function rainMultiplier(analog: number | null, all: number | null): string
{
    if (analog === null || all === null || all <= 0)
    {
        return "—";
    }
    return `${Math.round((analog / all) * 10) / 10}×`;
}

/**
 * Render an {@link AnalogOutlook} as canonical Markdown: header with lookback
 * metadata, the selected analog years with RMSE scores, a per-date table
 * comparing analog vs all-30 normals, whole-target aggregates, and an honest
 * skill caveat. Designed as a standalone artifact (not embedded in the daily
 * outlook).
 */
export function renderAnalogMarkdown(outlook: AnalogOutlook): string
{
    const locLabel = outlook.location.country
        ? `${outlook.location.name}, ${outlook.location.country}`
        : outlook.location.name;
    const lines: string[] = [];
    lines.push(`# Analog outlook — ${locLabel}`);
    lines.push("");
    lines.push(`Generated: ${outlook.generatedAt}`);
    if (outlook.lookbackStart && outlook.lookbackEnd)
    {
        lines.push(
            `Lookback: ${outlook.lookbackStart} → ${outlook.lookbackEnd} (${outlook.observedDays} day(s) observed in ${outlook.currentYear})`,
        );
    }
    lines.push(`Baseline: ${CLIMATE_BASELINE_LABEL} ERA5`);
    lines.push("Source: [Open-Meteo](https://open-meteo.com/) archive (ERA5 reanalysis)");
    lines.push("");

    if (outlook.degraded && outlook.note)
    {
        lines.push(`> **Degraded mode:** ${outlook.note}`);
        lines.push("");
    }

    // Analog years table.
    if (outlook.analogs.length > 0)
    {
        lines.push(`## Analog years (most similar to ${outlook.currentYear} so far)`);
        lines.push("");
        lines.push("| Rank | Year | RMSE °C |");
        lines.push("|---|---|---|");
        outlook.analogs.forEach((a, i) =>
        {
            lines.push(`| ${i + 1} | ${a.year} | ${cell(a.rmse, 2)} |`);
        });
        lines.push("");
    }

    // Per-date normals table.
    if (outlook.normals.length > 0)
    {
        const from = outlook.normals[0]?.date ?? "";
        const to = outlook.normals[outlook.normals.length - 1]?.date ?? "";
        lines.push(`## Target window ${from} → ${to}`);
        lines.push("");
        lines.push("| Date | Analog high | All-30 high | Δhigh | Analog rain mm | All-30 rain mm | ×rain |");
        lines.push("|---|---|---|---|---|---|---|");
        for (const n of outlook.normals)
        {
            lines.push(
                `| ${n.date} | ${cell(n.analogMax)} | ${cell(n.allMax)} | ${signedDelta(n.analogMax, n.allMax)}`
                + ` | ${cell(n.analogPrecip)} | ${cell(n.allPrecip)} | ${rainMultiplier(n.analogPrecip, n.allPrecip)} |`,
            );
        }
        lines.push("");
    }

    // Summary aggregates.
    if (outlook.analogAvgMax !== null || outlook.allAvgMax !== null)
    {
        lines.push("## Summary");
        lines.push("");
        const k = outlook.analogs.length;
        const analogLabel = k > 0 ? `Analog-based (${k} yr${k === 1 ? "" : "s"})` : "Analog-based";
        lines.push(
            `${analogLabel}: high ${cell(outlook.analogAvgMax)}°C, rain/day ${cell(outlook.analogAvgPrecip)}mm.`,
        );
        lines.push(`All-30 normal:        high ${cell(outlook.allAvgMax)}°C, rain/day ${cell(outlook.allAvgPrecip)}mm.`);
        const dTemp = signedDelta(outlook.analogAvgMax, outlook.allAvgMax);
        const dRain = signedDelta(outlook.analogAvgPrecip, outlook.allAvgPrecip);
        lines.push(`Difference:           ${dTemp}°C, ${dRain}mm rain/day.`);
        lines.push("");
    }

    // Skill caveat (always shown).
    lines.push("> **Skill caveat:** this is a conditioned climatology, not a forecast.");
    lines.push("> Even the best analog was a few °C off on average over the lookback window.");
    lines.push("> The atmosphere is chaotic — use this as a sharper-than-average seasonal guide,");
    lines.push("> and re-run a real forecast once the target is within 16 days.");
    lines.push("");

    return lines.join("\n");
}
