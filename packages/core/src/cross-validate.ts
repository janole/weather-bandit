import { getModelDef } from "./models.js";
import type { CrossValidation, ModelRun } from "./types.js";

/** Models agree on a scalar when they're all within `tol` of their mean. */
function withinTolerance(values: number[], tol: number): boolean
{
    if (values.length === 0)
    {
        return true;
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.every((v) => Math.abs(v - mean) <= tol);
}

/** Label for a model id in prose (e.g. "Best-match", "GFS"). */
function label(id: string): string
{
    return getModelDef(id)?.label ?? id;
}

/** Round to one decimal for prose. */
function r1(n: number): string
{
    return (Math.round(n * 10) / 10).toString();
}

/**
 * Compare the deterministic model runs day by day on temperature max, rain
 * sum, and wind max, classifying each as an agreement or disagreement. Models
 * that errored are noted separately and excluded from the comparison.
 */
export function crossValidate(models: ModelRun[]): CrossValidation
{
    const agreements: string[] = [];
    const disagreements: string[] = [];

    const ok = models.filter((m) => !m.error);
    for (const m of models)
    {
        if (m.error)
        {
            disagreements.push(`${label(m.model)} unavailable: ${m.error}`);
        }
    }

    if (ok.length < 2)
    {
        return { agreements, disagreements };
    }

    const dates = ok[0]?.daily?.map((d) => d.date) ?? [];
    for (const date of dates)
    {
        const tempMaxes = ok
            .map((m) => m.daily?.find((d) => d.date === date)?.tempMax)
            .filter((v): v is number => v !== null && v !== undefined);
        const precipSums = ok
            .map((m) => m.daily?.find((d) => d.date === date)?.precipSum)
            .filter((v): v is number => v !== null && v !== undefined);
        const windMaxes = ok
            .map((m) => m.daily?.find((d) => d.date === date)?.windMax)
            .filter((v): v is number => v !== null && v !== undefined);

        if (tempMaxes.length >= 2)
        {
            if (withinTolerance(tempMaxes, 2))
            {
                const mean = tempMaxes.reduce((a, b) => a + b, 0) / tempMaxes.length;
                agreements.push(`${date}: models agree on a high near ${r1(mean)}°C`);
            }
            else
            {
                const parts = ok.map((m) => `${label(m.model)}=${r1(m.daily?.find((d) => d.date === date)?.tempMax ?? NaN)}`);
                const spread = Math.max(...tempMaxes) - Math.min(...tempMaxes);
                disagreements.push(`${date}: high diverges (Δ${r1(spread)}°C) — ${parts.join(", ")}`);
            }
        }

        if (precipSums.length >= 2)
        {
            const dry = precipSums.every((v) => v < 0.1);
            const wet = precipSums.every((v) => v >= 0.1);
            if (dry || wet)
            {
                const mean = precipSums.reduce((a, b) => a + b, 0) / precipSums.length;
                agreements.push(`${date}: models agree on ${dry ? "dry" : "rain"} (${r1(mean)}mm)`);
            }
            else
            {
                const parts = ok.map((m) => `${label(m.model)}=${r1(m.daily?.find((d) => d.date === date)?.precipSum ?? NaN)}`);
                disagreements.push(`${date}: rain disagrees — ${parts.join(", ")}mm`);
            }
        }

        if (windMaxes.length >= 2)
        {
            if (withinTolerance(windMaxes, 5))
            {
                const mean = windMaxes.reduce((a, b) => a + b, 0) / windMaxes.length;
                agreements.push(`${date}: models agree on wind max near ${r1(mean)}km/h`);
            }
            else
            {
                const parts = ok.map((m) => `${label(m.model)}=${r1(m.daily?.find((d) => d.date === date)?.windMax ?? NaN)}`);
                const spread = Math.max(...windMaxes) - Math.min(...windMaxes);
                disagreements.push(`${date}: wind max diverges (Δ${r1(spread)}km/h) — ${parts.join(", ")}`);
            }
        }
    }

    return { agreements, disagreements };
}
