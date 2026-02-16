/**
 * Weather Tools - OpenWeatherMap Integration
 * Provides get_weather and get_forecast tools with 30-min caching.
 * Requires OPENWEATHERMAP_API_KEY env var.
 */

import { registerTool } from './tool-executor';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const REQUEST_TIMEOUT_MS = 8000;

interface WeatherCacheEntry {
  data: unknown;
  timestamp: number;
}

const weatherCache = new Map<string, WeatherCacheEntry>();

function getApiKey(): string | null {
  return process.env.OPENWEATHERMAP_API_KEY || null;
}

function getDefaultCity(): string {
  return process.env.WEATHER_CITY || 'New York';
}

function getCached(key: string): unknown | null {
  const entry = weatherCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    weatherCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: unknown): void {
  // Evict old entries if cache grows too large
  if (weatherCache.size > 20) {
    const oldest = Array.from(weatherCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) weatherCache.delete(oldest[0]);
  }
  weatherCache.set(key, { data, timestamp: Date.now() });
}

async function fetchWeatherAPI(endpoint: string, params: Record<string, string>): Promise<unknown> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No weather API key. Add OPENWEATHERMAP_API_KEY to your .env.local file.');

  const url = new URL(`https://api.openweathermap.org/data/2.5/${endpoint}`);
  url.searchParams.set('appid', apiKey);
  url.searchParams.set('units', 'imperial');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Weather API error (${res.status}): ${text}`);
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ─── get_weather ───

registerTool('get_weather', 'Get current weather for a location. Use when asked about weather, temperature, or conditions.', async (args) => {
  const { location } = args as { location?: string };
  const city = (typeof location === 'string' && location.trim()) ? location.trim() : getDefaultCity();

  // Check cache
  const cacheKey = `weather:${city.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return { success: true, data: cached };

  try {
    const data = await fetchWeatherAPI('weather', { q: city }) as Record<string, unknown>;
    const main = data.main as Record<string, number>;
    const weather = (data.weather as Array<Record<string, string>>)[0];
    const wind = data.wind as Record<string, number>;
    const sys = data.sys as Record<string, unknown>;

    const result = {
      city: data.name,
      country: sys.country,
      temp: Math.round(main.temp),
      feels_like: Math.round(main.feels_like),
      temp_min: Math.round(main.temp_min),
      temp_max: Math.round(main.temp_max),
      humidity: main.humidity,
      description: weather.description,
      icon: weather.icon,
      wind_speed: Math.round(wind.speed),
      visibility: typeof data.visibility === 'number' ? Math.round((data.visibility as number) / 1609) : null, // miles
      sunrise: sys.sunrise ? new Date((sys.sunrise as number) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null,
      sunset: sys.sunset ? new Date((sys.sunset as number) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null,
    };

    setCache(cacheKey, result);
    return {
      success: true,
      data: result,
      message: `${result.city}: ${result.temp}°F (feels like ${result.feels_like}°F), ${result.description}. Wind: ${result.wind_speed} mph. Humidity: ${result.humidity}%.`,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Weather fetch failed' };
  }
});

// ─── get_forecast ───

registerTool('get_forecast', 'Get weather forecast for upcoming days. Shows 5-day forecast.', async (args) => {
  const { location, days = 3 } = args as { location?: string; days?: number };
  const city = (typeof location === 'string' && location.trim()) ? location.trim() : getDefaultCity();
  const numDays = Math.min(Math.max(1, typeof days === 'number' ? days : 3), 5);

  const cacheKey = `forecast:${city.toLowerCase()}:${numDays}`;
  const cached = getCached(cacheKey);
  if (cached) return { success: true, data: cached };

  try {
    const data = await fetchWeatherAPI('forecast', { q: city, cnt: String(numDays * 8) }) as Record<string, unknown>;
    const list = data.list as Array<Record<string, unknown>>;
    const cityInfo = data.city as Record<string, unknown>;

    // Group by day and pick noon reading (or closest to noon)
    const dailyMap = new Map<string, Record<string, unknown>>();
    for (const entry of list) {
      const date = new Date((entry.dt as number) * 1000);
      const dateKey = date.toISOString().split('T')[0];
      const hour = date.getHours();

      // Prefer noon (12:00) reading for the day summary
      const existing = dailyMap.get(dateKey);
      if (!existing || Math.abs(hour - 12) < Math.abs((existing._hour as number) - 12)) {
        const main = entry.main as Record<string, number>;
        const weather = (entry.weather as Array<Record<string, string>>)[0];
        const wind = entry.wind as Record<string, number>;
        dailyMap.set(dateKey, {
          date: dateKey,
          day: date.toLocaleDateString('en-US', { weekday: 'long' }),
          temp: Math.round(main.temp),
          temp_min: Math.round(main.temp_min),
          temp_max: Math.round(main.temp_max),
          humidity: main.humidity,
          description: weather.description,
          wind_speed: Math.round(wind.speed),
          _hour: hour,
        });
      }
    }

    const forecast = Array.from(dailyMap.values())
      .slice(0, numDays)
      .map(({ _hour, ...rest }) => rest);

    const result = { city: cityInfo.name, country: (cityInfo.country as string), forecast };
    setCache(cacheKey, result);

    const summary = forecast.map(d =>
      `${(d as Record<string, unknown>).day}: ${(d as Record<string, unknown>).temp}°F, ${(d as Record<string, unknown>).description}`
    ).join('. ');

    return { success: true, data: result, message: `${numDays}-day forecast for ${cityInfo.name}: ${summary}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Forecast fetch failed' };
  }
});

// Export for use in briefing
export { getApiKey as getWeatherApiKey, getDefaultCity };
