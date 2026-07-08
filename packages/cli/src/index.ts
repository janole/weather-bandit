import { readFileSync } from "node:fs";
import { dirname,join } from "node:path";
import { fileURLToPath } from "node:url";

import { Command } from "commander";

import { makeAnalogCommand } from "./commands/analog.js";
import { makeExportMdCommand } from "./commands/export-md.js";
import { makeOutlookCommand } from "./commands/outlook.js";

const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), "../package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
const VERSION = packageJson.version ?? "0.0.0";

/** Build the Commander program (without running it). Useful for tests. */
export function createProgram(): Command
{
    const program = new Command();
    program
        .name("weather-bandit")
        .description(
            "Deterministic, LLM-free weather forecasts from Open-Meteo — cross-validated models, ensemble probabilities, and a Markdown + JSON daily outlook.",
        )
        .version(VERSION);

    program.addCommand(makeAnalogCommand());
    program.addCommand(makeOutlookCommand());
    program.addCommand(makeExportMdCommand());

    return program;
}

/**
 * Run the CLI with the given arguments. Errors are printed to stderr and
 * `process.exitCode` is set (never calls `process.exit` directly so tests
 * can capture output without the process dying).
 */
export function cli(argv: string[]): void
{
    const program = createProgram();
    program.exitOverride();
    try
    {
        program.parse(["node", "weather-bandit", ...argv]);
    }
    catch (err)
    {
        const e = err as { exitCode?: number; code?: string };
        if (e.code === "commander.help" || e.code === "commander.version")
        {
            return;
        }
        if (e.exitCode !== undefined)
        {
            process.exitCode = e.exitCode;
        }
    }
}
