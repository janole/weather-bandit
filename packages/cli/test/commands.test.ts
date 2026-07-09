import type { Command } from "commander";
import { describe, expect, it } from "vitest";

import { createProgram } from "../src/index.js";

describe("createProgram", () =>
{
    it("exposes the outlook and analog commands", () =>
    {
        const program = createProgram();
        const names = program.commands.map((c: Command) => c.name());
        expect(names).toContain("outlook");
        expect(names).toContain("analog");
    });

    it("outlook has a [city] argument and --json/--days/--style options", () =>
    {
        const program = createProgram();
        const outlook = program.commands.find((c) => c.name() === "outlook")!;
        const argNames = outlook.registeredArguments.map((a) => a.name());
        expect(argNames).toContain("city");
        const optFlags = outlook.options.map((o) => o.long);
        expect(optFlags).toContain("--json");
        expect(optFlags).toContain("--days");
        expect(optFlags).toContain("--style");
    });

    it("analog has a [city] argument and required --from/--to plus --lookback/--top/--json options", () =>
    {
        const program = createProgram();
        const analog = program.commands.find((c) => c.name() === "analog")!;
        const argNames = analog.registeredArguments.map((a) => a.name());
        expect(argNames).toContain("city");
        const optFlags = analog.options.map((o) => o.long);
        expect(optFlags).toContain("--from");
        expect(optFlags).toContain("--to");
        expect(optFlags).toContain("--lookback");
        expect(optFlags).toContain("--top");
        expect(optFlags).toContain("--json");
        const from = analog.options.find((o) => o.long === "--from");
        const to = analog.options.find((o) => o.long === "--to");
        expect(from?.required).toBe(true);
        expect(to?.required).toBe(true);
    });

    it("parses --help without exiting the process", () =>
    {
        const program = createProgram();
        program.exitOverride();
        expect(() => program.parse(["node", "weather-bandit", "--help"])).toThrow();
    });
});
