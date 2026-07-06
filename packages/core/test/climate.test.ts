import { describe, expect, it, vi } from "vitest";

import { CLIMATE_BASELINE_END_YEAR,CLIMATE_BASELINE_LABEL, CLIMATE_BASELINE_START_YEAR, fetchClimateNormals } from "../src/climate.js";
import type { Location } from "../src/types.js";

const berlin: Location = { name: "Berlin", latitude: 52.52, longitude: 13.405, country: "Germany" };

/** Install a fake global fetch returning the given daily payload for the archive endpoint. */
function mockArchive(daily: { time: string[]; temperature_2m_max?: (number | null)[]; temperature_2m_min?: (number | null)[]; precipitation_sum?: (number | null)[] }): void
{
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    {
        if (!String(url).includes("archive-api.open-meteo.com"))
        {
            throw new Error(`unexpected url: ${url}`);
        }
        return {
            ok: true,
            status: 200,
            json: async () => ({ daily }),
        } as Response;
    }));
}

describe("fetchClimateNormals", () =>
{
    it("averages each calendar date across the baseline years", async () =>
    {
        // Two baseline years, two forecast days: July 6 and July 7.
        mockArchive({
            time: ["1991-07-06", "1992-07-06", "1991-07-07", "1992-07-07"],
            temperature_2m_max: [20, 24, 22, 26],       // Jul6 mean=22, Jul7 mean=24
            temperature_2m_min: [10, 12, 11, 13],       // Jul6 mean=11, Jul7 mean=12
            precipitation_sum: [0, 2, 4, 6],             // Jul6 mean=1, Jul7 mean=5
        });
        const out = await fetchClimateNormals(berlin, ["2026-07-06", "2026-07-07"]);
        expect(out).toHaveLength(2);
        expect(out[0] ?? null).toEqual({ date: "2026-07-06", normalMax: 22, normalMin: 11, normalPrecip: 1 });
        expect(out[1] ?? null).toEqual({ date: "2026-07-07", normalMax: 24, normalMin: 12, normalPrecip: 5 });
    });

    it("ignores null values when averaging", async () =>
    {
        mockArchive({
            time: ["1991-07-06", "1992-07-06", "1993-07-06"],
            temperature_2m_max: [null, 24, 26],   // mean of [24,26] = 25
            temperature_2m_min: [10, null, 14],   // mean of [10,14] = 12
            precipitation_sum: [0, null, 4],       // mean of [0,4] = 2
        });
        const out = await fetchClimateNormals(berlin, ["2026-07-06"]);
        expect(out[0]?.normalMax).toBe(25);
        expect(out[0]?.normalMin).toBe(12);
        expect(out[0]?.normalPrecip).toBe(2);
    });

    it("returns nulls when a calendar date has no baseline data", async () =>
    {
        mockArchive({
            time: ["1991-07-06"],
            temperature_2m_max: [20],
            temperature_2m_min: [10],
            precipitation_sum: [0],
        });
        const out = await fetchClimateNormals(berlin, ["2026-07-06", "2026-12-25"]);
        expect(out[0]?.normalMax).toBe(20);
        expect(out[1] ?? null).toEqual({ date: "2026-12-25", normalMax: null, normalMin: null, normalPrecip: null });
    });

    it("returns an empty array for no forecast dates", async () =>
    {
        const out = await fetchClimateNormals(berlin, []);
        expect(out).toEqual([]);
    });

    it("degrades gracefully on a failed request", async () =>
    {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response));
        const out = await fetchClimateNormals(berlin, ["2026-07-06"]);
        expect(out).toEqual([]);
    });

    it("degrades gracefully on a network error", async () =>
    {
        vi.stubGlobal("fetch", vi.fn(async () =>
        {
            throw new Error("timeout");
        }));
        const out = await fetchClimateNormals(berlin, ["2026-07-06"]);
        expect(out).toEqual([]);
    });
});

describe("climate baseline constants", () =>
{
    it("exposes the WMO-standard 1991–2020 baseline", () =>
    {
        expect(CLIMATE_BASELINE_START_YEAR).toBe(1991);
        expect(CLIMATE_BASELINE_END_YEAR).toBe(2020);
        expect(CLIMATE_BASELINE_LABEL).toBe("1991–2020");
    });
});
