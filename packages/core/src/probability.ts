import type { ProbabilityBand } from "./types.js";

/**
 * Percentile via linear interpolation between closest ranks (the common
 * `numpy`-style default). `p` is 0–100. An empty input returns `NaN`.
 */
export function percentile(values: number[], p: number): number
{
    if (values.length === 0)
    {
        return NaN;
    }
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length === 1)
    {
        return sorted[0]!;
    }
    const rank = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    if (lo === hi)
    {
        return sorted[lo]!;
    }
    const frac = rank - lo;
    return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac;
}

/** Fraction of `values` at or above `threshold` (0–1). */
export function probabilityAtOrAbove(values: number[], threshold: number): number
{
    if (values.length === 0)
    {
        return 0;
    }
    const count = values.filter((v) => v >= threshold).length;
    return count / values.length;
}

/** Group hourly timestamps into per-date index ranges, preserving order. */
function groupByDate(times: string[]): Map<string, [number, number]>
{
    const ranges = new Map<string, [number, number]>();
    for (let i = 0; i < times.length; i++)
    {
        const date = times[i]!.slice(0, 10);
        const existing = ranges.get(date);
        if (existing)
        {
            existing[1] = i;
        }
        else
        {
            ranges.set(date, [i, i]);
        }
    }
    return ranges;
}

/** For one member, the daily max temperature on `date` (NaN if no valid hours). */
function memberDailyMax(member: (number | null)[], lo: number, hi: number): number
{
    let max = NaN;
    for (let i = lo; i <= hi; i++)
    {
        const v = member[i];
        if (v === null || v === undefined)
        {
            continue;
        }
        if (Number.isNaN(max) || v > max)
        {
            max = v;
        }
    }
    return max;
}

/**
 * Compute per-day probability bands from the 30 ensemble members: for each
 * date, take each member's daily max temperature, then derive the p10/p25/
 * p50/p75/p90 percentile bands and P(max ≥ 28/30/32°C). Members with no valid
 * temperature on a date are skipped for that date.
 */
export function computeProbabilityBands(
    times: string[],
    members: (number | null)[][],
): ProbabilityBand[]
{
    const ranges = groupByDate(times);
    const bands: ProbabilityBand[] = [];
    for (const [date, [lo, hi]] of ranges)
    {
        const dailyMaxes = members
            .map((m) => memberDailyMax(m, lo, hi))
            .filter((v) => !Number.isNaN(v));
        if (dailyMaxes.length === 0)
        {
            continue;
        }
        bands.push({
            date,
            p10: round1(percentile(dailyMaxes, 10)),
            p25: round1(percentile(dailyMaxes, 25)),
            p50: round1(percentile(dailyMaxes, 50)),
            p75: round1(percentile(dailyMaxes, 75)),
            p90: round1(percentile(dailyMaxes, 90)),
            pMax28: round3(probabilityAtOrAbove(dailyMaxes, 28)),
            pMax30: round3(probabilityAtOrAbove(dailyMaxes, 30)),
            pMax32: round3(probabilityAtOrAbove(dailyMaxes, 32)),
        });
    }
    return bands;
}

/** Round to one decimal place. */
function round1(n: number): number
{
    return Math.round(n * 10) / 10;
}

/** Round to three decimal places (probabilities are 0–1). */
function round3(n: number): number
{
    return Math.round(n * 1000) / 1000;
}
