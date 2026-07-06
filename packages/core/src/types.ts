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
    /** Plain-English summary derived from the data. */
    summary: string;
}

/** Result of comparing deterministic models for agreement. */
export interface CrossValidation
{
    agreements: string[];
    disagreements: string[];
}

/** The default "my cities" config; the CLI uses the first entry when no city is passed. */
export const DEFAULT_CITIES: string[] = ["Berlin"];
