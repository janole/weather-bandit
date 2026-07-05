/**
 * Deterministic model identifiers, their Open-Meteo endpoints, and which v0
 * variables each supports. The best-match endpoint (`/v1/forecast`) lets
 * Open-Meteo pick the right model for the location (DWD ICON for Berlin); the
 * response carries no `model` field, so we label it `best-match`.
 */

/** Hourly variables requested from every deterministic model. */
export const HOURLY_VARS = [
    "windspeed_10m",
    "winddirection_10m",
    "windgusts_10m",
    "temperature_2m",
    "precipitation",
    "cloud_cover",
] as const;

/** Daily aggregate variables requested from every deterministic model. */
export const DAILY_VARS = [
    "temperature_2m_max",
    "temperature_2m_min",
    "precipitation_sum",
    "weather_code",
    "wind_speed_10m_max",
] as const;

/** A deterministic model definition: id, label, and Open-Meteo endpoint path. */
export interface ModelDef
{
    /** Stable model identifier used in {@link ModelRun.model}. */
    id: string;
    /** Human-readable label for tables and Markdown. */
    label: string;
    /** Endpoint path under `https://api.open-meteo.com`. */
    endpoint: string;
    /** Whether the model provides wind gusts (ECMWF does not). */
    hasWindGusts: boolean;
}

/** The three deterministic models cross-validated in v0. */
export const MODELS: ModelDef[] = [
    {
        id: "best-match",
        label: "Best-match",
        endpoint: "/v1/forecast",
        hasWindGusts: true,
    },
    {
        id: "gfs",
        label: "GFS",
        endpoint: "/v1/gfs",
        hasWindGusts: true,
    },
    {
        id: "ecmwf",
        label: "ECMWF",
        endpoint: "/v1/ecmwf",
        hasWindGusts: false,
    },
];

/** Find a model definition by id. */
export function getModelDef(id: string): ModelDef | undefined
{
    return MODELS.find((m) => m.id === id);
}
