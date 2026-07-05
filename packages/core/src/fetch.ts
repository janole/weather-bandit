import { DAILY_VARS, HOURLY_VARS, type ModelDef,MODELS } from "./models.js";
import { computeProbabilityBands } from "./probability.js";
import type { DailySummary, HourlyPoint, Location, ModelRun, ProbabilityBand } from "./types.js";

const FORECAST_BASE = "https://api.open-meteo.com";
const ENSEMBLE_URL = "https://ensemble-api.open-meteo.com/v1/ensemble";

/** Maximum days the ensemble endpoint serves (30 members, hourly, 16 days). */
const MAX_ENSEMBLE_DAYS = 16;

/** Raw hourly arrays from a deterministic model response. */
interface RawHourly
{
    time: string[];
    windspeed_10m?: (number | null)[];
    winddirection_10m?: (number | null)[];
    windgusts_10m?: (number | null)[];
    temperature_2m?: (number | null)[];
    precipitation?: (number | null)[];
    cloud_cover?: (number | null)[];
}

/** Raw daily arrays from a deterministic model response. */
interface RawDaily
{
    time: string[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    precipitation_sum?: (number | null)[];
    weather_code?: (number | null)[];
    wind_speed_10m_max?: (number | null)[];
}

interface ForecastResponse
{
    hourly?: RawHourly;
    daily?: RawDaily;
}

/** Coerce a possibly-missing array element to `number | null`. */
function at(arr: (number | null)[] | undefined, i: number): number | null
{
    const v = arr?.[i];
    return v === undefined ? null : v;
}

/** Map a raw hourly block into normalized {@link HourlyPoint}s. */
function parseHourly(raw: RawHourly): HourlyPoint[]
{
    const times = raw.time ?? [];
    return times.map((time, i) => ({
        time,
        windspeed: at(raw.windspeed_10m, i),
        winddirection: at(raw.winddirection_10m, i),
        windgusts: at(raw.windgusts_10m, i),
        temperature: at(raw.temperature_2m, i),
        precipitation: at(raw.precipitation, i),
        cloudCover: at(raw.cloud_cover, i),
    }));
}

/** Map a raw daily block into normalized {@link DailySummary}s. */
function parseDaily(raw: RawDaily): DailySummary[]
{
    const dates = raw.time ?? [];
    return dates.map((date, i) => ({
        date,
        tempMax: at(raw.temperature_2m_max, i),
        tempMin: at(raw.temperature_2m_min, i),
        precipSum: at(raw.precipitation_sum, i),
        weatherCode: at(raw.weather_code, i),
        windMax: at(raw.wind_speed_10m_max, i),
    }));
}

/** Build the deterministic query string shared by all three models. */
function deterministicQuery(loc: Location, forecastDays: number): string
{
    const hourly = HOURLY_VARS.join(",");
    const daily = DAILY_VARS.join(",");
    return [
        `latitude=${loc.latitude}`,
        `longitude=${loc.longitude}`,
        `hourly=${hourly}`,
        `daily=${daily}`,
        "wind_speed_unit=kmh",
        "timezone=auto",
        `forecast_days=${forecastDays}`,
    ].join("&");
}

/** Fetch one deterministic model, returning a {@link ModelRun} (never throws). */
async function fetchModel(model: ModelDef, loc: Location, forecastDays: number): Promise<ModelRun>
{
    const url = `${FORECAST_BASE}${model.endpoint}?${deterministicQuery(loc, forecastDays)}`;
    try
    {
        const res = await fetch(url);
        if (!res.ok)
        {
            return { model: model.id, hourly: [], daily: [], error: `HTTP ${res.status}` };
        }
        const data = (await res.json()) as ForecastResponse;
        const hourly = data.hourly ? parseHourly(data.hourly) : [];
        const daily = data.daily ? parseDaily(data.daily) : undefined;
        return { model: model.id, hourly, daily };
    }
    catch (err)
    {
        const msg = err instanceof Error ? err.message : String(err);
        return { model: model.id, hourly: [], daily: [], error: msg };
    }
}

/**
 * Fetch all three deterministic model runs for a location. A model that fails
 * is returned with an `error` field and empty arrays — it never aborts the
 * whole call.
 */
export async function fetchDeterministic(loc: Location, forecastDays: number): Promise<ModelRun[]>
{
    const runs = await Promise.all(
        MODELS.map((def) => fetchModel(def, loc, forecastDays)),
    );
    return runs;
}

// --- ensemble ----------------------------------------------------------------

interface EnsembleHourly
{
    time: string[];
    /** Mean temperature (a separate key from the per-member keys). */
    temperature_2m?: (number | null)[];
    [member: string]: (number | null)[] | string[] | undefined;
}

interface EnsembleResponse
{
    hourly?: EnsembleHourly;
}

/** Extract the 30 per-member temperature arrays from an ensemble hourly block. */
function extractMembers(hourly: EnsembleHourly): (number | null)[][]
{
    const members: (number | null)[][] = [];
    for (let n = 1; n <= 30; n++)
    {
        const key = `temperature_2m_member${String(n).padStart(2, "0")}`;
        const arr = hourly[key];
        if (Array.isArray(arr))
        {
            members.push(arr as (number | null)[]);
        }
    }
    return members;
}

/**
 * Fetch the 30-member ensemble (default blend — no `models` param) and compute
 * per-day probability bands for temperature. The ensemble serves up to 16 days.
 */
export async function fetchEnsemble(loc: Location, forecastDays: number): Promise<ProbabilityBand[]>
{
    const days = Math.min(forecastDays, MAX_ENSEMBLE_DAYS);
    const url = `${ENSEMBLE_URL}?latitude=${loc.latitude}&longitude=${loc.longitude}&hourly=temperature_2m&timezone=Europe/Berlin&forecast_days=${days}`;
    const res = await fetch(url);
    if (!res.ok)
    {
        throw new Error(`Ensemble request failed (${res.status})`);
    }
    const data = (await res.json()) as EnsembleResponse;
    const hourly = data.hourly;
    if (!hourly || !hourly.time || hourly.time.length === 0)
    {
        return [];
    }
    const members = extractMembers(hourly);
    if (members.length === 0)
    {
        return [];
    }
    return computeProbabilityBands(hourly.time, members);
}
