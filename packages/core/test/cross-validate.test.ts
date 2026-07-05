import { describe, expect, it } from "vitest";

import { crossValidate } from "../src/cross-validate.js";
import type { ModelRun } from "../src/types.js";

/** A minimal model run with one day of daily aggregates. */
function run(model: string, day: { date: string; tempMax: number; precipSum: number; windMax: number }): ModelRun
{
    return {
        model,
        hourly: [],
        daily: [{ date: day.date, tempMax: day.tempMax, tempMin: 10, precipSum: day.precipSum, weatherCode: 0, windMax: day.windMax }],
    };
}

describe("crossValidate", () =>
{
    it("records an agreement when models agree on the high", () =>
    {
        const cv = crossValidate([
            run("best-match", { date: "2026-07-05", tempMax: 23.7, precipSum: 0.2, windMax: 22 }),
            run("gfs", { date: "2026-07-05", tempMax: 22.9, precipSum: 0.0, windMax: 21 }),
            run("ecmwf", { date: "2026-07-05", tempMax: 23.0, precipSum: 0.1, windMax: 20 }),
        ]);
        expect(cv.agreements.some((a) => a.includes("agree on a high"))).toBe(true);
        // Dry/wet: two models are dry (<0.1 is not, 0.0 is dry, 0.1 is not <0.1) -> mixed, so a rain disagreement is possible.
        expect(cv.disagreements.some((d) => d.includes("unavailable"))).toBe(false);
    });

    it("records a disagreement when the high diverges beyond 2°C", () =>
    {
        const cv = crossValidate([
            run("best-match", { date: "2026-07-05", tempMax: 25, precipSum: 0, windMax: 20 }),
            run("gfs", { date: "2026-07-05", tempMax: 22, precipSum: 0, windMax: 20 }),
            run("ecmwf", { date: "2026-07-05", tempMax: 20, precipSum: 0, windMax: 20 }),
        ]);
        expect(cv.disagreements.some((d) => d.includes("high diverges"))).toBe(true);
    });

    it("notes an errored model as a disagreement and still compares the rest", () =>
    {
        const cv = crossValidate([
            run("best-match", { date: "2026-07-05", tempMax: 23, precipSum: 0, windMax: 20 }),
            run("gfs", { date: "2026-07-05", tempMax: 23, precipSum: 0, windMax: 20 }),
            { model: "ecmwf", hourly: [], daily: [], error: "HTTP 500" },
        ]);
        expect(cv.disagreements.some((d) => d.includes("ECMWF unavailable: HTTP 500"))).toBe(true);
        expect(cv.agreements.some((a) => a.includes("agree on a high"))).toBe(true);
    });

    it("skips comparisons when fewer than two models are available", () =>
    {
        const cv = crossValidate([
            run("best-match", { date: "2026-07-05", tempMax: 23, precipSum: 0, windMax: 20 }),
            { model: "gfs", hourly: [], daily: [], error: "timeout" },
            { model: "ecmwf", hourly: [], daily: [], error: "timeout" },
        ]);
        expect(cv.disagreements.filter((d) => d.includes("unavailable"))).toHaveLength(2);
        // No agreement/disagreement about weather, only the availability notes.
        expect(cv.agreements).toEqual([]);
        expect(cv.disagreements.filter((d) => !d.includes("unavailable"))).toEqual([]);
    });
});
