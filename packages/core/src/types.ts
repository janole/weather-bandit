/**
 * Core types for weather-bandit — the normalized shape the engine produces
 * from Open-Meteo's deterministic + ensemble endpoints. This is the boundary
 * between raw API responses and every consumer (the CLI, the Markdown
 * renderer, programmatic callers).
 */

/** A geocoded location resolved from a city name. */
export interface Location
{
    name: string;
    latitude: number;
    longitude: number;
    /** Country label from the geocoder, if available. */
    country?: string;
    /** ISO 3166-1 alpha-2 country code from the geocoder, if available. */
    countryCode?: string;
    /** IANA time zone from the geocoder, if available. */
    timezone?: string;
}

/** One hour of forecast data for a single deterministic model. */
export interface HourlyPoint
{
    /** Local ISO-like time, e.g. `2026-07-05T00:00` (Open-Meteo returns local, no offset). */
    time: string;
    windspeed: number | null;
    winddirection: number | null;
    /** Null when the model does not provide gusts (e.g. ECMWF). */
    windgusts: number | null;
    temperature: number | null;
    precipitation: number | null;
    cloudCover: number | null;
}

/** One day of daily-aggregate forecast data for a single deterministic model. */
export interface DailySummary
{
    /** Local date, e.g. `2026-07-05`. */
    date: string;
    tempMax: number | null;
    tempMin: number | null;
    precipSum: number | null;
    /** WMO weather code. */
    weatherCode: number | null;
    windMax: number | null;
    /** Mean cloud cover over the day (0–100), computed from the hourly series. */
    cloudCoverMean: number | null;
}

/** A full deterministic model run: hourly series plus daily aggregates. */
export interface ModelRun
{
    /** Model identifier, e.g. `best-match`, `gfs`, `ecmwf`. */
    model: string;
    hourly: HourlyPoint[];
    daily?: DailySummary[];
    /** Present when the run failed or returned partial data; hourly/daily may be empty. */
    error?: string;
}

/** Per-day ensemble-derived temperature probabilities and percentile bands. */
export interface ProbabilityBand
{
    /** Local date, e.g. `2026-07-05`. */
    date: string;
    /** 10th percentile of the per-member daily-max distribution (°C). */
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    /** P(daily max ≥ 28°C), 0–1. */
    pMax28: number;
    /** P(daily max ≥ 30°C), 0–1. */
    pMax30: number;
    /** P(daily max ≥ 32°C), 0–1. */
    pMax32: number;
}

/** One day's long-term climate normal (baseline mean) for comparison against the forecast. */
export interface ClimateNormal
{
    /** Forecast date this normal applies to, e.g. `2026-07-06`. */
    date: string;
    /** Baseline mean of the daily max temperature for this calendar date (°C), or null if unavailable. */
    normalMax: number | null;
    /** Baseline mean of the daily min temperature for this calendar date (°C). */
    normalMin: number | null;
    /** Baseline mean of the daily precipitation sum for this calendar date (mm). */
    normalPrecip: number | null;
}

/** The complete structured outlook assembled by the engine. */
export interface Outlook
{
    location: Location;
    /** ISO 8601 generation timestamp. */
    generatedAt: string;
    /** Number of forecast days covered. */
    forecastDays: number;
    models: ModelRun[];
    probabilities: ProbabilityBand[];
    /** Per-day long-term climate normals (1991–2020 ERA5 baseline) for anomaly context; empty if unavailable. */
    climate: ClimateNormal[];
    /** Plain-English summary derived from the data. */
    summary: string;
}

/** Result of comparing deterministic models for agreement. */
export interface CrossValidation
{
    agreements: string[];
    disagreements: string[];
}

/** One candidate analog year and its similarity score to the current year. */
export interface AnalogYear
{
    /** Calendar year, e.g. `"2020"`. */
    year: string;
    /** Similarity metric: RMSE of daily max temp over the lookback window (°C). Lower = more similar. */
    rmse: number;
}

/** A per-date conditional normal built from the selected analog years, with the unconditional all-30 normal for comparison. */
export interface AnalogNormal
{
    /** Target date, e.g. `"2026-08-21"`. */
    date: string;
    /** Mean of the analog years' daily max for this calendar date (°C), or null if unavailable. */
    analogMax: number | null;
    /** Mean of the analog years' daily min for this calendar date (°C). */
    analogMin: number | null;
    /** Mean of the analog years' daily precipitation sum for this calendar date (mm). */
    analogPrecip: number | null;
    /** The unconditional all-30 normal max for the same date (°C). */
    allMax: number | null;
    /** The unconditional all-30 normal min for the same date (°C). */
    allMin: number | null;
    /** The unconditional all-30 normal precipitation for the same date (mm). */
    allPrecip: number | null;
}

/** Complete result of an analog forecast (conditional climatology). */
export interface AnalogOutlook
{
    location: Location;
    /** ISO 8601 generation timestamp. */
    generatedAt: string;
    /** The calendar window used to characterize "so far" (ISO date). */
    lookbackStart: string;
    lookbackEnd: string;
    /** The year used as the "current" signature (e.g. `"2026"` if available, else `"2025"`). */
    currentYear: string;
    /** Number of days of current-year observation actually used (may be < window if gaps). */
    observedDays: number;
    /** Selected analog years, best (lowest RMSE) first. */
    analogs: AnalogYear[];
    /** Per-target-date conditional + unconditional normals. */
    normals: AnalogNormal[];
    /** Whole-target aggregate: mean analog high (°C), or null if degraded. */
    analogAvgMax: number | null;
    /** Whole-target aggregate: mean analog rain/day (mm). */
    analogAvgPrecip: number | null;
    /** Whole-target aggregate: mean all-30 high (°C). */
    allAvgMax: number | null;
    /** Whole-target aggregate: mean all-30 rain/day (mm). */
    allAvgPrecip: number | null;
    /** True if the current-year recent data was insufficient and we fell back to all-30 only. */
    degraded: boolean;
    /** Human-readable note explaining degradation or caveats, if any. */
    note?: string;
}

/** The default "my cities" config; the CLI uses the first entry when no city is passed. */
export const DEFAULT_CITIES: string[] = ["Berlin"];
