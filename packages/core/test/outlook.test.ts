import { describe, expect, it } from "vitest";

import { renderOutlookFrontmatter, renderOutlookMarkdown } from "../src/outlook.js";
import type { Outlook } from "../src/types.js";

/** A minimal fixture outlook used by the rendering tests. */
function fixtureOutlook(overrides: Partial<Outlook> = {}): Outlook
{
    return {
        location: { name: "Berlin", latitude: 52.52, longitude: 13.405, country: "Germany" },
        generatedAt: "2026-07-05T11:42:00.000Z",
        forecastDays: 7,
        models: [],
        probabilities: [],
        summary: "Berlin: clear sky.",
        ...overrides,
    };
}

describe("renderOutlookFrontmatter", () =>
{
    it("emits layout outlook and the title as City · date", () =>
    {
        const fm = renderOutlookFrontmatter(fixtureOutlook());
        expect(fm).toContain("layout: outlook");
        expect(fm).toContain("title: \"Berlin · 2026-07-05\"");
    });

    it("includes city, country, date, generatedAt, forecastDays and an empty heroImage slot", () =>
    {
        const fm = renderOutlookFrontmatter(fixtureOutlook());
        expect(fm).toContain("city: \"Berlin\"");
        expect(fm).toContain("country: \"Germany\"");
        expect(fm).toContain("date: 2026-07-05");
        expect(fm).toContain("generatedAt: 2026-07-05T11:42:00.000Z");
        expect(fm).toContain("forecastDays: 7");
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
});
