import type { ClimateNormal, Location } from "./types.js";

/** Open-Meteo archive (ERA5 reanalysis) base URL for historical data. */
const ARCHIVE_BASE = "https://archive-api.open-meteo.com";

/** WMO-standard climate baseline period used for computing normals. */
export const CLIMATE_BASELINE_START_YEAR = 1991;
export const CLIMATE_BASELINE_END_YEAR = 2020;

/** Human-readable label for the baseline period, used in rendering. */
export const CLIMATE_BASELINE_LABEL = "1991–2020";

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

/** Arithmetic mean of a non-empty number array. */
function mean(values: number[]): number
{
    return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Fetch per-day long-term climate normals for the given forecast dates from the
 * Open-Meteo archive (ERA5 reanalysis). The normal for a calendar date is the
 * mean of that date's daily max/min/precipitation over the 1991–2020 baseline.
 *
 * Implementation note: a single contiguous request spanning the baseline range
 * for the forecast's calendar window is used (rather than many per-year
 * requests) to stay under the no-key API's rate limit. The response covers
 * every day in the range; we filter client-side by calendar date (MM-DD).
 * Returns an empty array if the request fails — the outlook degrades gracefully.
 */
export async function fetchClimateNormals(loc: Location, forecastDates: string[]): Promise<ClimateNormal[]>
{
    if (forecastDates.length === 0)
    {
        return [];
    }
    const first = forecastDates[0];
    const last = forecastDates[forecastDates.length - 1];
    if (!first || !last)
    {
        return [];
    }
    const firstMmdd = first.slice(5);
    const lastMmdd = last.slice(5);
    const startDate = `${CLIMATE_BASELINE_START_YEAR}-${firstMmdd}`;
    const endDate = `${CLIMATE_BASELINE_END_YEAR}-${lastMmdd}`;
    const url =
        `${ARCHIVE_BASE}/v1/archive?latitude=${loc.latitude}&longitude=${loc.longitude}`
        + `&start_date=${startDate}&end_date=${endDate}`
        + "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto";
    try
    {
        const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok)
        {
            return [];
        }
        const data = (await res.json()) as ArchiveResponse;
        const daily = data.daily;
        if (!daily || !daily.time || daily.time.length === 0)
        {
            return [];
        }
        // Group baseline values by calendar date (MM-DD) and average.
        const groups = new Map<string, { max: number[]; min: number[]; precip: number[] }>();
        for (let i = 0; i < daily.time.length; i++)
        {
            const time = daily.time[i];
            if (!time)
            {
                continue;
            }
            const mmdd = time.slice(5);
            const g = groups.get(mmdd) ?? { max: [], min: [], precip: [] };
            const mx = daily.temperature_2m_max?.[i];
            const mn = daily.temperature_2m_min?.[i];
            const pr = daily.precipitation_sum?.[i];
            if (mx !== undefined && mx !== null)
            {
                g.max.push(mx);
            }
            if (mn !== undefined && mn !== null)
            {
                g.min.push(mn);
            }
            if (pr !== undefined && pr !== null)
            {
                g.precip.push(pr);
            }
            groups.set(mmdd, g);
        }
        return forecastDates.map((date) =>
        {
            const g = groups.get(date.slice(5));
            return {
                date,
                normalMax: g && g.max.length > 0 ? mean(g.max) : null,
                normalMin: g && g.min.length > 0 ? mean(g.min) : null,
                normalPrecip: g && g.precip.length > 0 ? mean(g.precip) : null,
            };
        });
    }
    catch
    {
        // Network/timeout/parse failure — degrade gracefully (no climate context).
        return [];
    }
}
