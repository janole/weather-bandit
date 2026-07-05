import type { Location } from "./types.js";

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";

/** Raw shape of one geocoding result from Open-Meteo. */
interface GeocodeResult
{
    name: string;
    latitude: number;
    longitude: number;
    country?: string;
}

interface GeocodeResponse
{
    results?: GeocodeResult[];
}

/**
 * Resolve a city name to a {@link Location} via the Open-Meteo geocoding API.
 * Throws if the city cannot be found.
 */
export async function geocode(city: string): Promise<Location>
{
    const url = `${GEOCODE_URL}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
    const res = await fetch(url);
    if (!res.ok)
    {
        throw new Error(`Geocoding request failed (${res.status}) for city "${city}"`);
    }
    const data = (await res.json()) as GeocodeResponse;
    const result = data.results?.[0];
    if (!result)
    {
        throw new Error(`No geocoding result for city "${city}"`);
    }
    return {
        name: result.name,
        latitude: result.latitude,
        longitude: result.longitude,
        country: result.country,
    };
}
