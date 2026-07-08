import { buildAnalogOutlook, DEFAULT_ANALOG_TOP, DEFAULT_CITIES, DEFAULT_LOOKBACK_DAYS, renderAnalogMarkdown } from "@weather-bandit/core";
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

/** Validate an ISO date argument (`YYYY-MM-DD`). Returns the string or throws. */
function parseDate(value: string, flag: string): string
{
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    {
        throw new Error(`Invalid ${flag} value: "${value}". Use YYYY-MM-DD.`);
    }
    const d = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(d.getTime()))
    {
        throw new Error(`Invalid ${flag} value: "${value}". Not a real date.`);
    }
    return value;
}

interface AnalogOptions
{
    from: string;
    to: string;
    lookback: number;
    top: number;
    json?: boolean;
}

/** Make the `analog` command — print an analog (conditional climatology) outlook. */
export function makeAnalogCommand(): Command
{
    const cmd = new Command("analog");
    cmd
        .description("Analog forecast (conditional climatology) for a target period beyond the forecast horizon")
        .argument("[city]", "City name (default: Berlin)")
        .requiredOption("--from <YYYY-MM-DD>", "Target start date")
        .requiredOption("--to <YYYY-MM-DD>", "Target end date")
        .option("-l, --lookback <days>", "Lookback window length in days (default 21)", (v) => Number.parseInt(v, 10), DEFAULT_LOOKBACK_DAYS)
        .option("--top <n>", "Number of analog years to select (default 8)", (v) => Number.parseInt(v, 10), DEFAULT_ANALOG_TOP)
        .option("--json", "Print the structured AnalogOutlook as JSON")
        .action(async (city: string | undefined, opts: AnalogOptions) =>
        {
            let from: string;
            let to: string;
            try
            {
                from = parseDate(opts.from, "--from");
                to = parseDate(opts.to, "--to");
            }
            catch (err)
            {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(msg);
                process.exitCode = 1;
                return;
            }
            if (from > to)
            {
                console.error(`--from (${from}) must be on or before --to (${to}).`);
                process.exitCode = 1;
                return;
            }
            if (!Number.isFinite(opts.lookback) || opts.lookback < 1)
            {
                console.error(`Invalid --lookback value: "${String(opts.lookback)}". Use a positive integer.`);
                process.exitCode = 1;
                return;
            }
            if (!Number.isFinite(opts.top) || opts.top < 1)
            {
                console.error(`Invalid --top value: "${String(opts.top)}". Use a positive integer.`);
                process.exitCode = 1;
                return;
            }
            const name = resolveCity(city);
            try
            {
                const outlook = await buildAnalogOutlook(name, {
                    from,
                    to,
                    lookbackDays: opts.lookback,
                    top: opts.top,
                });
                if (opts.json)
                {
                    console.log(JSON.stringify(outlook, null, 2));
                }
                else
                {
                    console.log(renderAnalogMarkdown(outlook));
                }
            }
            catch (err)
            {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`Failed to build analog outlook for "${name}": ${msg}`);
                process.exitCode = 1;
            }
        });
    return cmd;
}
