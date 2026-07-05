import { describe, expect, it } from "vitest";

import { computeProbabilityBands, percentile, probabilityAtOrAbove } from "../src/probability.js";

describe("percentile", () =>
{
    it("returns NaN for an empty input", () =>
    {
        expect(Number.isNaN(percentile([], 50))).toBe(true);
    });

    it("returns the single value for a one-element input", () =>
    {
        expect(percentile([7], 50)).toBe(7);
    });

    it("interpolates linearly between closest ranks", () =>
    {
        expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
        expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5);
        expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
        expect(percentile([1, 2, 3, 4, 5], 25)).toBe(2);
        expect(percentile([1, 2, 3, 4, 5], 10)).toBeCloseTo(1.4, 10);
    });

    it("ignores input order", () =>
    {
        expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3);
    });
});

describe("probabilityAtOrAbove", () =>
{
    it("returns 0 for an empty input", () =>
    {
        expect(probabilityAtOrAbove([], 30)).toBe(0);
    });

    it("returns the fraction at or above the threshold", () =>
    {
        expect(probabilityAtOrAbove([28, 29, 30, 31], 30)).toBe(0.5);
        expect(probabilityAtOrAbove([20, 20, 20], 28)).toBe(0);
        expect(probabilityAtOrAbove([30, 30, 30], 30)).toBe(1);
    });
});

/** Build 24 hourly timestamps for a date: `YYYY-MM-DDTHH:MM`. */
function dayTimes(date: string): string[]
{
    return Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, "0")}:00`);
}

describe("computeProbabilityBands", () =>
{
    it("groups by date and derives percentile bands + threshold probabilities", () =>
    {
        const times = dayTimes("2026-07-05");
        const members = [
            Array(24).fill(20), // daily max 20
            Array(24).fill(30), // daily max 30
            Array(24).fill(29), // daily max 29
        ];
        const bands = computeProbabilityBands(times, members);
        expect(bands).toHaveLength(1);
        const band = bands[0]!;
        expect(band.date).toBe("2026-07-05");
        expect(band.p50).toBe(29);
        expect(band.pMax28).toBeCloseTo(2 / 3, 3);
        expect(band.pMax30).toBeCloseTo(1 / 3, 3);
        expect(band.pMax32).toBe(0);
    });

    it("handles multiple dates with separate per-day maxes", () =>
    {
        const times = [...dayTimes("2026-07-05"), ...dayTimes("2026-07-06")];
        // Member 1: day1 max 20, day2 max 33; Member 2: day1 max 28, day2 max 31
        const m1 = [...Array(24).fill(20), ...Array(24).fill(33)];
        const m2 = [...Array(24).fill(28), ...Array(24).fill(31)];
        const bands = computeProbabilityBands(times, [m1, m2]);
        expect(bands.map((b) => b.date)).toEqual(["2026-07-05", "2026-07-06"]);
        const d1 = bands[0]!;
        const d2 = bands[1]!;
        // day1: maxes [20, 28] -> P(>=28) = 0.5
        expect(d1.pMax28).toBe(0.5);
        expect(d1.pMax32).toBe(0);
        // day2: maxes [33, 31] -> P(>=32) = 0.5
        expect(d2.pMax32).toBe(0.5);
    });

    it("skips a member with no valid temperatures on a date", () =>
    {
        const times = dayTimes("2026-07-05");
        const m1 = Array(24).fill(20);
        const m2 = Array(24).fill(null);
        const bands = computeProbabilityBands(times, [m1, m2]);
        expect(bands).toHaveLength(1);
        expect(bands[0]!.p50).toBe(20);
    });
});
