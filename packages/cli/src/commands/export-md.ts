import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildOutlook, DEFAULT_CITIES, DEFAULT_FORECAST_DAYS, renderOutlookFrontmatter, renderOutlookMarkdown } from "@weather-bandit/core";
import { Command } from "commander";

/** Resolve the city argument, falling back to the first configured city. */
function resolveCity(city: string | undefined): string
{
    if (city)
    {
        return city;
    }
    const fallback = DEFAULT_CITIES[0];
    if (!fallback)
    {
        throw new Error("No city provided and the default cities config is empty.");
    }
    return fallback;
}

/** Slugify a city name for filenames (lowercase, hyphenated, ASCII-folded). */
function slugify(name: string): string
{
    return name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function writeFile(path: string, contents: string): void
{
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, contents, "utf8");
}

/** Make the `export-md` command — write canonical Markdown + JSON to a directory. */
export function makeExportMdCommand(): Command
{
    const cmd = new Command("export-md");
    cmd
        .description("Write the canonical Markdown + JSON outlook to a directory")
        .argument("[city]", "City name (default: Berlin)")
        .requiredOption("--out <dir>", "Output directory")
        .option("-d, --days <n>", "Forecast days (default 7)", (v) => Number.parseInt(v, 10), DEFAULT_FORECAST_DAYS)
        .action(async (city: string | undefined, opts: ExportMdOptions) =>
        {
            const days = opts.days;
            if (!Number.isFinite(days) || days < 1)
            {
                console.error(`Invalid --days value: "${String(opts.days)}". Use a positive integer.`);
                process.exitCode = 1;
                return;
            }
            const name = resolveCity(city);
            try
            {
                const outlook = await buildOutlook(name, days);
                const date = outlook.generatedAt.slice(0, 10);
                const base = `${date}-${slugify(outlook.location.name)}`;
                const mdPath = join(opts.out, `${base}.md`);
                const jsonPath = join(opts.out, `${base}.json`);
                writeFile(mdPath, renderOutlookFrontmatter(outlook) + "\n\n" + renderOutlookMarkdown(outlook) + "\n");
                writeFile(jsonPath, JSON.stringify(outlook, null, 2) + "\n");
                console.log(mdPath);
                console.log(jsonPath);
            }
            catch (err)
            {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`Failed to export outlook for "${name}": ${msg}`);
                process.exitCode = 1;
            }
        });
    return cmd;
}

interface ExportMdOptions
{
    out: string;
    days: number;
}
