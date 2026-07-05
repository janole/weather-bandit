import type { OutlookMarkdownStyle } from "@weather-bandit/core";
import { buildOutlook, DEFAULT_CITIES, DEFAULT_FORECAST_DAYS, renderOutlookMarkdown } from "@weather-bandit/core";
import { Command } from "commander";

const MARKDOWN_STYLES = new Set<OutlookMarkdownStyle>(["full", "summary", "tables", "briefing"]);

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

/** Make the `outlook` command — print a cross-validated outlook to stdout. */
export function makeOutlookCommand(): Command
{
    const cmd = new Command("outlook");
    cmd
        .description("Print a cross-validated weather outlook for a city")
        .argument("[city]", "City name (default: Berlin)")
        .option("-d, --days <n>", "Forecast days (default 7)", (v) => Number.parseInt(v, 10), DEFAULT_FORECAST_DAYS)
        .option("--json", "Print the structured Outlook as JSON")
        .option("--style <style>", "Markdown style: full, summary, tables, briefing", "full")
        .action(async (city: string | undefined, opts: OutlookOptions) =>
        {
            const days = opts.days;
            if (!Number.isFinite(days) || days < 1)
            {
                console.error(`Invalid --days value: "${String(opts.days)}". Use a positive integer.`);
                process.exitCode = 1;
                return;
            }
            if (!MARKDOWN_STYLES.has(opts.style))
            {
                console.error(`Invalid --style value: "${opts.style}". Use one of: full, summary, tables, briefing.`);
                process.exitCode = 1;
                return;
            }
            const name = resolveCity(city);
            try
            {
                const outlook = await buildOutlook(name, days);
                if (opts.json)
                {
                    console.log(JSON.stringify(outlook, null, 2));
                }
                else
                {
                    console.log(renderOutlookMarkdown(outlook, { style: opts.style }));
                }
            }
            catch (err)
            {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`Failed to build outlook for "${name}": ${msg}`);
                process.exitCode = 1;
            }
        });
    return cmd;
}

interface OutlookOptions
{
    days: number;
    json?: boolean;
    style: OutlookMarkdownStyle;
}
