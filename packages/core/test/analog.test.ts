import { describe, expect, it, vi } from "vitest";

import { buildAnalogOutlook, computeNormals, groupByYear, inMmddWindow, renderAnalogMarkdown, selectAnalogs, similarity } from "../src/analog.js";
import type { AnalogYear, Location } from "../src/types.js";

const berlin: Location = { name: "Berlin", latitude: 52.52, longitude: 13.405, country: "Germany" };

/** A mock geocode response for Berlin. */
const geocodeResponse = {
    ok: true,
    status: 200,
    json: async () => ({ results: [{ name: "Berlin", latitude: 52.52, longitude: 13.405, country: "Germany" }] }),
} as Response;

describe("inMmddWindow", () =>
{
    it("matches a simple within-year window", () =>
    {
        expect(inMmddWindow("06-20", "06-15", "07-05")).toBe(true);
        expect(inMmddWindow("06-15", "06-15", "07-05")).toBe(true);
        expect(inMmddWindow("07-05", "06-15", "07-05")).toBe(true);
        expect(inMmddWindow("06-14", "06-15", "07-05")).toBe(false);
        expect(inMmddWindow("07-06", "06-15", "07-05")).toBe(false);
    });

    it("matches a year-crossing window (Dec → Jan)", () =>
    {
        expect(inMmddWindow("12-25", "12-20", "01-05")).toBe(true);
        expect(inMmddWindow("01-01", "12-20", "01-05")).toBe(true);
        expect(inMmddWindow("12-20", "12-20", "01-05")).toBe(true);
        expect(inMmddWindow("01-05", "12-20", "01-05")).toBe(true);
        expect(inMmddWindow("12-19", "12-20", "01-05")).toBe(false);
        expect(inMmddWindow("01-06", "12-20", "01-05")).toBe(false);
    });
});

describe("groupByYear", () =>
{
    it("groups archive days by year, filtering to the MM-DD window", () =>
    {
        const out = groupByYear(
            ["1991-06-15", "1991-07-01", "1991-08-01", "2020-06-15", "2020-07-01"],
            [20, 25, 30, 22, 27],
            [10, 15, 20, 12, 17],
            [0, 2, 5, 1, 3],
            "06-15",
            "07-05",
        );
        // August 1 is outside the window and should be excluded.
        expect(out.size).toBe(2);
        expect(out.get("1991")?.size).toBe(2);
        expect(out.get("2020")?.size).toBe(2);
        expect(out.get("1991")?.get("06-15")).toEqual({ max: 20, min: 10, precip: 0 });
        expect(out.get("1991")?.get("07-01")).toEqual({ max: 25, min: 15, precip: 2 });
        expect(out.get("1991")?.get("08-01")).toBeUndefined();
        expect(out.get("2020")?.get("06-15")).toEqual({ max: 22, min: 12, precip: 1 });
    });

    it("handles a year-crossing window (Dec → Jan)", () =>
    {
        const out = groupByYear(
            ["1991-12-25", "1991-01-03", "1991-12-10", "1992-12-25"],
            [-2, 0, -5, -3],
            [-8, -10, -12, -9],
            [1, 0, 0, 2],
            "12-20",
            "01-05",
        );
        // Dec 10 is outside; Dec 25 and Jan 03 are inside.
        expect(out.get("1991")?.size).toBe(2);
        expect(out.get("1991")?.get("12-25")).toEqual({ max: -2, min: -8, precip: 1 });
        expect(out.get("1991")?.get("01-03")).toEqual({ max: 0, min: -10, precip: 0 });
        expect(out.get("1991")?.get("12-10")).toBeUndefined();
        expect(out.get("1992")?.get("12-25")).toEqual({ max: -3, min: -9, precip: 2 });
    });

    it("preserves null values", () =>
    {
        const out = groupByYear(
            ["1991-06-15", "1991-06-16"],
            [null, 24],
            [10, null],
            [0, 2],
            "06-15",
            "06-20",
        );
        expect(out.get("1991")?.get("06-15")).toEqual({ max: null, min: 10, precip: 0 });
        expect(out.get("1991")?.get("06-16")).toEqual({ max: 24, min: null, precip: 2 });
    });
});

describe("similarity", () =>
{
    it("computes RMSE of daily max temp paired by MM-DD", () =>
    {
        const current = new Map([
            ["06-15", { max: 20, min: 10, precip: 0 }],
            ["06-16", { max: 22, min: 12, precip: 1 }],
            ["06-17", { max: 24, min: 14, precip: 0 }],
        ]);
        const candidate = new Map([
            ["06-15", { max: 18, min: 8, precip: 0 }],
            ["06-16", { max: 22, min: 10, precip: 2 }],
            ["06-17", { max: 28, min: 16, precip: 0 }],
        ]);
        // diffs: |20-18|=2, |22-22|=0, |24-28|=4 → RMSE = sqrt((4+0+16)/3) = sqrt(20/3)
        expect(similarity(current, candidate)).toBeCloseTo(Math.sqrt(20 / 3), 5);
    });

    it("skips days where either year has a null max", () =>
    {
        const current = new Map([
            ["06-15", { max: 20, min: 10, precip: 0 }],
            ["06-16", { max: null, min: 12, precip: 1 }],
            ["06-17", { max: 24, min: 14, precip: 0 }],
        ]);
        const candidate = new Map([
            ["06-15", { max: 18, min: 8, precip: 0 }],
            ["06-16", { max: 22, min: 10, precip: 2 }],
            ["06-17", { max: null, min: 16, precip: 0 }],
        ]);
        // Only 06-15 has both non-null: diff=2, RMSE = sqrt(4/1) = 2
        expect(similarity(current, candidate)).toBeCloseTo(2, 5);
    });

    it("returns Infinity when there are no overlapping non-null days", () =>
    {
        const current = new Map([
            ["06-15", { max: null, min: 10, precip: 0 }],
        ]);
        const candidate = new Map([
            ["06-15", { max: 20, min: 8, precip: 0 }],
        ]);
        expect(similarity(current, candidate)).toBe(Number.POSITIVE_INFINITY);
    });
});

describe("selectAnalogs", () =>
{
    it("sorts by RMSE ascending and takes the top-K", () =>
    {
        const scores: AnalogYear[] = [
            { year: "2010", rmse: 5.0 },
            { year: "2020", rmse: 3.0 },
            { year: "2015", rmse: 4.0 },
            { year: "2005", rmse: 6.0 },
        ];
        const top = selectAnalogs(scores, 2);
        expect(top.map((a) => a.year)).toEqual(["2020", "2015"]);
    });

    it("returns fewer than K when not enough candidates", () =>
    {
        const scores: AnalogYear[] = [{ year: "2020", rmse: 3.0 }];
        expect(selectAnalogs(scores, 5)).toEqual([{ year: "2020", rmse: 3.0 }]);
    });

    it("does not mutate the input array", () =>
    {
        const scores: AnalogYear[] = [
            { year: "2010", rmse: 5.0 },
            { year: "2020", rmse: 3.0 },
        ];
        selectAnalogs(scores, 1);
        expect(scores[0]?.year).toBe("2010");
    });
});

describe("computeNormals", () =>
{
    it("computes analog-conditional vs all-baseline means per target date", () =>
    {
        // 3 baseline years; year "2000" and "2001" are analogs.
        const targetByYear = new Map([
            ["1999", new Map([
                ["08-21", { max: 18, min: 10, precip: 1 }],
                ["08-22", { max: 20, min: 12, precip: 0 }],
            ])],
            ["2000", new Map([
                ["08-21", { max: 22, min: 14, precip: 3 }],
                ["08-22", { max: 24, min: 16, precip: 2 }],
            ])],
            ["2001", new Map([
                ["08-21", { max: 24, min: 16, precip: 5 }],
                ["08-22", { max: 26, min: 18, precip: 4 }],
            ])],
        ]);
        const analogYears = new Set(["2000", "2001"]);
        const normals = computeNormals(targetByYear, analogYears, ["2026-08-21", "2026-08-22"]);
        expect(normals).toHaveLength(2);
        // Analog mean for 08-21: (22+24)/2 = 23; all-30 mean: (18+22+24)/3 ≈ 21.33
        expect(normals[0]?.date).toBe("2026-08-21");
        expect(normals[0]?.analogMax).toBe(23);
        expect(normals[0]?.analogMin).toBe(15);
        expect(normals[0]?.analogPrecip).toBe(4);
        expect(normals[0]?.allMax).toBeCloseTo(64 / 3, 5);
        expect(normals[0]?.allMin).toBeCloseTo(40 / 3, 5);
        expect(normals[0]?.allPrecip).toBeCloseTo(9 / 3, 5);
        // Analog mean for 08-22: (24+26)/2 = 25; all: (20+24+26)/3 ≈ 23.33
        expect(normals[1]?.analogMax).toBe(25);
        expect(normals[1]?.allMax).toBeCloseTo(70 / 3, 5);
    });

    it("returns nulls when a target date has no data in any year", () =>
    {
        const targetByYear = new Map([
            ["2000", new Map([["08-21", { max: 22, min: 14, precip: 3 }]])],
        ]);
        const normals = computeNormals(targetByYear, new Set(["2000"]), ["2026-08-21", "2026-12-25"]);
        expect(normals[0]?.analogMax).toBe(22);
        expect(normals[1] ?? null).toEqual({
            date: "2026-12-25",
            analogMax: null,
            analogMin: null,
            analogPrecip: null,
            allMax: null,
            allMin: null,
            allPrecip: null,
        });
    });

    it("with an empty analog set, analog fields are null but all fields are populated", () =>
    {
        const targetByYear = new Map([
            ["2000", new Map([["08-21", { max: 22, min: 14, precip: 3 }]])],
            ["2001", new Map([["08-21", { max: 24, min: 16, precip: 5 }]])],
        ]);
        const normals = computeNormals(targetByYear, new Set(), ["2026-08-21"]);
        expect(normals[0]?.analogMax).toBeNull();
        expect(normals[0]?.analogMin).toBeNull();
        expect(normals[0]?.analogPrecip).toBeNull();
        expect(normals[0]?.allMax).toBe(23);
        expect(normals[0]?.allPrecip).toBe(4);
    });
});

// --- integration: buildAnalogOutlook (mocked fetch) -------------------------

/** Build lookback test data: 10 days for each of 1991, 1992, 2026. */
function buildLookbackData(): {
    daily: {
        time: string[];
        temperature_2m_max: (number | null)[];
        temperature_2m_min: (number | null)[];
        precipitation_sum: (number | null)[];
    };
}
{
    const days = ["06-15", "06-16", "06-17", "06-18", "06-19", "06-20", "06-21", "06-22", "06-23", "06-24"];
    const years = ["1991", "1992", "2026"];
    const time: string[] = [];
    const tMax: (number | null)[] = [];
    const tMin: (number | null)[] = [];
    const precip: (number | null)[] = [];
    for (const yr of years)
    {
        for (let i = 0; i < days.length; i++)
        {
            time.push(`${yr}-${days[i]}`);
            // 1991 and 2026: 20 + i. 1992: 25 + i (consistently +5°C off).
            tMax.push(yr === "1992" ? 25 + i : 20 + i);
            tMin.push(yr === "1992" ? 15 + i : 10 + i);
            precip.push(yr === "1992" ? 5 + i : i);
        }
    }
    return { daily: { time, temperature_2m_max: tMax, temperature_2m_min: tMin, precipitation_sum: precip } };
}

describe("buildAnalogOutlook", () =>
{
    it("selects analog years and computes conditional vs unconditional normals", async () =>
    {
        // Fix the current date so the lookback window (06-15..07-05) is deterministic.
        vi.setSystemTime(new Date("2026-07-08T12:00:00Z"));
        const lookback = buildLookbackData();
        // Target window: 08-21..08-22 for 1991 and 1992.
        const target = {
            daily: {
                time: ["1991-08-21", "1991-08-22", "1992-08-21", "1992-08-22"],
                temperature_2m_max: [19, 21, 17, 19],
                temperature_2m_min: [11, 13, 9, 11],
                precipitation_sum: [2, 0, 4, 2],
            },
        };
        vi.stubGlobal("fetch", vi.fn(async (url: string) =>
        {
            const u = String(url);
            if (u.includes("geocoding-api.open-meteo.com"))
            {
                return geocodeResponse;
            }
            if (!u.includes("archive-api.open-meteo.com"))
            {
                throw new Error(`unexpected url: ${u}`);
            }
            // Lookback ends in 2026; target ends in 2020.
            const isLookback = u.includes("end_date=2026-");
            return {
                ok: true,
                status: 200,
                json: async () => (isLookback ? lookback : target),
            } as Response;
        }));

        const out = await buildAnalogOutlook("Berlin", {
            from: "2026-08-21",
            to: "2026-08-22",
            lookbackDays: 21,
            top: 1,
        });
        expect(out.degraded).toBe(false);
        expect(out.currentYear).toBe("2026");
        expect(out.observedDays).toBe(10);
        expect(out.analogs).toHaveLength(1);
        // 1991 should be the best analog (identical to 2026 → RMSE 0).
        expect(out.analogs[0]?.year).toBe("1991");
        expect(out.analogs[0]?.rmse).toBe(0);
        // Target normals: analog (1991 only) vs all-30 (1991+1992).
        expect(out.normals).toHaveLength(2);
        expect(out.normals[0]?.analogMax).toBe(19); // 1991-08-21
        expect(out.normals[0]?.allMax).toBe(18); // (19+17)/2
        expect(out.normals[0]?.analogPrecip).toBe(2);
        expect(out.normals[0]?.allPrecip).toBe(3); // (2+4)/2
        // Whole-target aggregates.
        expect(out.analogAvgMax).toBe(20); // (19+21)/2
        expect(out.allAvgMax).toBe(19); // (19+21+17+19)/4
        vi.useRealTimers();
    });

    it("degrades gracefully when the current-year lookback data is sparse", async () =>
    {
        vi.setSystemTime(new Date("2026-07-08T12:00:00Z"));
        // 2026 has only 1 non-null day (< MIN_OBSERVED_DAYS=10); 2025 has 1 too.
        const lookback = {
            daily: {
                time: ["2026-06-15", "2026-06-16", "2025-06-15", "2025-06-16", "1991-06-15"],
                temperature_2m_max: [20, null, 18, null, 20],
                temperature_2m_min: [10, null, 8, null, 10],
                precipitation_sum: [0, null, 1, null, 0],
            },
        };
        const target = {
            daily: {
                time: ["1991-08-21", "1992-08-21"],
                temperature_2m_max: [19, 21],
                temperature_2m_min: [11, 13],
                precipitation_sum: [2, 4],
            },
        };
        vi.stubGlobal("fetch", vi.fn(async (url: string) =>
        {
            const u = String(url);
            if (u.includes("geocoding-api.open-meteo.com"))
            {
                return geocodeResponse;
            }
            if (!u.includes("archive-api.open-meteo.com"))
            {
                throw new Error(`unexpected url: ${u}`);
            }
            const isLookback = u.includes("end_date=2026-");
            return {
                ok: true,
                status: 200,
                json: async () => (isLookback ? lookback : target),
            } as Response;
        }));

        const out = await buildAnalogOutlook("Berlin", {
            from: "2026-08-21",
            to: "2026-08-21",
            lookbackDays: 21,
            top: 1,
        });
        expect(out.degraded).toBe(true);
        expect(out.analogs).toEqual([]);
        expect(out.analogAvgMax).toBeNull();
        expect(out.allAvgMax).toBe(20); // (19+21)/2
        expect(out.normals).toHaveLength(1);
        expect(out.normals[0]?.analogMax).toBeNull();
        expect(out.normals[0]?.allMax).toBe(20);
        expect(out.note).toBeTruthy();
        vi.useRealTimers();
    });

    it("degrades gracefully on a fetch failure", async () =>
    {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response));
        const out = await buildAnalogOutlook("Berlin", {
            from: "2026-08-21",
            to: "2026-08-22",
        });
        expect(out.degraded).toBe(true);
        expect(out.analogs).toEqual([]);
        expect(out.normals).toEqual([]);
        expect(out.note).toBeTruthy();
    });

    it("degrades gracefully on a network error", async () =>
    {
        vi.stubGlobal("fetch", vi.fn(async () =>
        {
            throw new Error("timeout");
        }));
        const out = await buildAnalogOutlook("Berlin", {
            from: "2026-08-21",
            to: "2026-08-22",
        });
        expect(out.degraded).toBe(true);
        expect(out.note).toBeTruthy();
    });
});

describe("renderAnalogMarkdown", () =>
{
    it("renders a complete, non-degraded outlook with all sections", () =>
    {
        const md = renderAnalogMarkdown({
            location: berlin,
            generatedAt: "2026-07-08T12:00:00.000Z",
            lookbackStart: "2026-06-15",
            lookbackEnd: "2026-07-05",
            currentYear: "2026",
            observedDays: 21,
            analogs: [
                { year: "2020", rmse: 4.01 },
                { year: "2019", rmse: 4.57 },
            ],
            normals: [
                {
                    date: "2026-08-21",
                    analogMax: 18.8,
                    analogMin: 12.1,
                    analogPrecip: 6.9,
                    allMax: 18.7,
                    allMin: 11.9,
                    allPrecip: 3.9,
                },
            ],
            analogAvgMax: 18.1,
            analogAvgPrecip: 4.7,
            allAvgMax: 17.8,
            allAvgPrecip: 3.5,
            degraded: false,
        });
        expect(md).toContain("# Analog outlook — Berlin, Germany");
        expect(md).toContain("Lookback: 2026-06-15 → 2026-07-05 (21 day(s) observed in 2026)");
        expect(md).toContain("## Analog years (most similar to 2026 so far)");
        expect(md).toContain("| 1 | 2020 | 4.01 |");
        expect(md).toContain("## Target window 2026-08-21 → 2026-08-21");
        expect(md).toContain("| 2026-08-21 | 18.8 | 18.7 | +0.1 | 6.9 | 3.9 | 1.8× |");
        expect(md).toContain("## Summary");
        expect(md).toContain("Analog-based (2 yrs): high 18.1°C, rain/day 4.7mm.");
        expect(md).toContain("All-30 normal:        high 17.8°C, rain/day 3.5mm.");
        expect(md).toContain("Skill caveat");
    });

    it("renders a degraded outlook with a note and no analog years table", () =>
    {
        const md = renderAnalogMarkdown({
            location: berlin,
            generatedAt: "2026-07-08T12:00:00.000Z",
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
            note: "Historical data unavailable.",
        });
        expect(md).toContain("# Analog outlook — Berlin, Germany");
        expect(md).toContain("Degraded mode");
        expect(md).toContain("Historical data unavailable.");
        expect(md).not.toContain("## Analog years");
        expect(md).not.toContain("## Target window");
        expect(md).not.toContain("## Summary");
        expect(md).toContain("Skill caveat");
    });

    it("renders a location without a country", () =>
    {
        const md = renderAnalogMarkdown({
            location: { name: "Blåvand", latitude: 55.55, longitude: 8.12 },
            generatedAt: "2026-07-08T12:00:00.000Z",
            lookbackStart: "2026-06-15",
            lookbackEnd: "2026-07-05",
            currentYear: "2026",
            observedDays: 21,
            analogs: [{ year: "2020", rmse: 4.0 }],
            normals: [],
            analogAvgMax: 18,
            analogAvgPrecip: 4,
            allAvgMax: 17,
            allAvgPrecip: 3,
            degraded: false,
        });
        expect(md).toContain("# Analog outlook — Blåvand");
    });
});
