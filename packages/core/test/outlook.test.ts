import { describe, expect, it } from "vitest";

import { renderOutlookFrontmatter, renderOutlookMarkdown } from "../src/outlook.js";
import type { Outlook } from "../src/types.js";

/** A minimal fixture outlook used by the rendering tests. */
function fixtureOutlook(overrides: Partial<Outlook> = {}): Outlook
{
    return {
        location: { name: "Berlin", latitude: 52.52, longitude: 13.405, country: "Germany", countryCode: "DE", timezone: "Europe/Berlin" },
        generatedAt: "2026-07-05T11:42:00.000Z",
        forecastDays: 7,
        models: [],
        probabilities: [],
        summary: "Berlin: clear sky.",
        ...overrides,
    };
}

function richFixtureOutlook(): Outlook
{
    const date = "2026-07-05";
    const hourly = [
        { time: `${date}T06:00`, windspeed: 10, winddirection: 260, windgusts: 20, temperature: 16, precipitation: 0.2, cloudCover: 90 },
        { time: `${date}T12:00`, windspeed: 18, winddirection: 270, windgusts: 35, temperature: 22, precipitation: 0, cloudCover: 50 },
        { time: `${date}T16:00`, windspeed: 22, winddirection: 280, windgusts: 49, temperature: 24, precipitation: 0, cloudCover: 35 },
    ];
    return fixtureOutlook({
        models: [
            {
                model: "best-match",
                hourly,
                daily: [
                    { date, tempMax: 24, tempMin: 15, precipSum: 0.2, weatherCode: 80, windMax: 22, cloudCoverMean: 58 },
                    { date: "2026-07-06", tempMax: 29, tempMin: 17, precipSum: 0, weatherCode: 1, windMax: 12, cloudCoverMean: null },
                ],
            },
            {
                model: "gfs",
                hourly: hourly.map((h) => ({ ...h, temperature: h.temperature + 1, windgusts: h.windgusts + 2 })),
                daily: [
                    { date, tempMax: 25, tempMin: 15, precipSum: 0.1, weatherCode: 80, windMax: 24, cloudCoverMean: 58 },
                    { date: "2026-07-06", tempMax: 31, tempMin: 18, precipSum: 0, weatherCode: 1, windMax: 15, cloudCoverMean: null },
                ],
            },
            {
                model: "ecmwf",
                hourly: hourly.map((h) => ({ ...h, temperature: h.temperature - 1, windgusts: null })),
                daily: [
                    { date, tempMax: 23, tempMin: 14, precipSum: 0.3, weatherCode: 80, windMax: 21, cloudCoverMean: 58 },
                    { date: "2026-07-06", tempMax: 28, tempMin: 16, precipSum: 0, weatherCode: 1, windMax: 11, cloudCoverMean: null },
                ],
            },
        ],
        probabilities: [
            { date, p10: 21, p25: 22, p50: 23, p75: 24, p90: 25, pMax28: 0, pMax30: 0, pMax32: 0 },
            { date: "2026-07-06", p10: 25, p25: 27, p50: 29, p75: 30, p90: 33, pMax28: 0.6, pMax30: 0.3, pMax32: 0.1 },
        ],
        summary: "Berlin: slight rain showers, high 24°C/low 15°C. Models disagree on 2 point(s): 2026-07-06: high diverges — Best-match=29, GFS=31, ECMWF=28; 2026-07-06: wind max diverges — Best-match=12, GFS=15, ECMWF=11. Ensemble (30 members): highest P(max ≥ 30°C) is 30% on 2026-07-06.",
    });
}

describe("renderOutlookFrontmatter", () =>
{
    it("emits layout outlook and the title as City · date", () =>
    {
        const fm = renderOutlookFrontmatter(fixtureOutlook());
        expect(fm).toContain("layout: outlook");
        expect(fm).toContain("title: \"Berlin · 2026-07-05\"");
    });

    it("includes city, country, date, generatedAt, forecastDays, dataFile and an empty heroImage slot", () =>
    {
        const fm = renderOutlookFrontmatter(fixtureOutlook());
        expect(fm).toContain("city: \"Berlin\"");
        expect(fm).toContain("country: \"Germany\"");
        expect(fm).toContain("date: 2026-07-05");
        expect(fm).toContain("generatedAt: 2026-07-05T11:42:00.000Z");
        expect(fm).toContain("forecastDays: 7");
        expect(fm).toContain("dataFile: 2026-07-05-berlin.json");
        expect(fm).toContain("heroImage:");
        // heroImage must be empty (no value after the colon on its own line)
        expect(fm).toMatch(/heroImage:\s*$/m);
    });

    it("omits the country line when the location has none", () =>
    {
        const fm = renderOutlookFrontmatter(fixtureOutlook({
            location: { name: "Tokyo", latitude: 35.68, longitude: 139.69 },
        }));
        expect(fm).not.toContain("country:");
        expect(fm).toContain("city: \"Tokyo\"");
    });

    it("starts and ends with YAML delimiters", () =>
    {
        const fm = renderOutlookFrontmatter(fixtureOutlook());
        expect(fm.startsWith("---\n")).toBe(true);
        expect(fm.endsWith("\n---")).toBe(true);
    });

    it("escapes embedded double quotes in the title/city", () =>
    {
        const fm = renderOutlookFrontmatter(fixtureOutlook({
            location: { name: "Saint \"Etienne\"", latitude: 0, longitude: 0, country: "France" },
        }));
        expect(fm).toContain("city: \"Saint \\\"Etienne\\\"\"");
        expect(fm).toContain("title: \"Saint \\\"Etienne\\\" · 2026-07-05\"");
    });
});

describe("renderOutlookMarkdown", () =>
{
    it("does not include frontmatter (terminal-friendly output)", () =>
    {
        const md = renderOutlookMarkdown(fixtureOutlook());
        expect(md.startsWith("---")).toBe(false);
        expect(md.startsWith("# Weather Outlook")).toBe(true);
    });

    it("supports a summary-focused Markdown style", () =>
    {
        const md = renderOutlookMarkdown(fixtureOutlook(), { style: "summary" });
        expect(md).toContain("## Summary");
        expect(md).toContain("## Daily summary");
        expect(md).not.toContain("## Today");
        expect(md).not.toContain("## Cross-validation");
    });

    it("supports a table-focused Markdown style", () =>
    {
        const md = renderOutlookMarkdown(fixtureOutlook(), { style: "tables" });
        expect(md).toContain("## Today");
        expect(md).toContain("## Daily summary");
        expect(md).toContain("## Probability bands");
        expect(md).not.toContain("## Summary");
    });

    it("supports a narrative briefing Markdown style", () =>
    {
        const md = renderOutlookMarkdown(richFixtureOutlook(), { style: "briefing" });
        expect(md).toContain("# Weather briefing — Berlin, Germany");
        expect(md).toContain("Generated: 5 Jul 2026, 13:42 (Europe/Berlin)");
        expect(md).toContain("## Today's weather update (Sun, 5 Jul 2026)");
        expect(md).toContain("| | Best-match | GFS | ECMWF |");
        expect(md).toContain("## Heat probability — ensemble analysis");
        expect(md).toContain("**30%**");
        expect(md).toContain("### My read");
        expect(md).toContain("### Bottom line");
        expect(md).toContain("- Berlin: slight rain showers");
        expect(md).toContain("- Models disagree on 2 point(s):");
        expect(md).toContain("  - Mon, 6 Jul 2026: high diverges");
        expect(md).toContain("- Ensemble (30 members): highest P(max ≥ 30°C) is 30% on Mon, 6 Jul 2026.");
        expect(md).not.toContain("### Caveats");
    });
});
