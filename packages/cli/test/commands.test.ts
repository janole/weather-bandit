import type { Command } from "commander";
import { describe, expect, it } from "vitest";

import { createProgram } from "../src/index.js";

describe("createProgram", () =>
{
    it("exposes the outlook and export-md commands", () =>
    {
        const program = createProgram();
        const names = program.commands.map((c: Command) => c.name());
        expect(names).toContain("outlook");
        expect(names).toContain("export-md");
    });

    it("outlook has a [city] argument and --json/--days options", () =>
    {
        const program = createProgram();
        const outlook = program.commands.find((c) => c.name() === "outlook")!;
        const argNames = outlook.registeredArguments.map((a) => a.name());
        expect(argNames).toContain("city");
        const optFlags = outlook.options.map((o) => o.long);
        expect(optFlags).toContain("--json");
        expect(optFlags).toContain("--days");
    });

    it("export-md requires --out", () =>
    {
        const program = createProgram();
        const exportMd = program.commands.find((c) => c.name() === "export-md")!;
        const out = exportMd.options.find((o) => o.long === "--out");
        expect(out?.required).toBe(true);
    });

    it("parses --help without exiting the process", () =>
    {
        const program = createProgram();
        program.exitOverride();
        expect(() => program.parse(["node", "weather-bandit", "--help"])).toThrow();
    });
});
