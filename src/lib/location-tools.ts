/**
 * Location Tools - Google Maps Integration
 * Provides get_traffic and find_nearby tools.
 * Requires GOOGLE_MAPS_API_KEY env var.
 */

import { registerTool } from './tool-executor';
import { getSetting, setSetting } from './db';

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const GEOCODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (locations don't change often)
const REQUEST_TIMEOUT_MS = 10000;

interface CacheEntry {
  data: unknown;
  timestamp: number;
}

const locationCache = new Map<string, CacheEntry>();

function getApiKey(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY || getSetting('google_maps_api_key') || null;
}

function getCached(key: string, ttl: number = CACHE_TTL_MS): unknown | null {
  const entry = locationCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttl) {
    locationCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: unknown): void {
  if (locationCache.size > 50) {
    const oldest = Array.from(locationCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) locationCache.delete(oldest[0]);
  }
  locationCache.set(key, { data, timestamp: Date.now() });
}

async function fetchGoogleMapsAPI(endpoint: string, params: Record<string, string>): Promise<unknown> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('No Google Maps API key. Add GOOGLE_MAPS_API_KEY to your .env.local file. Get one at https://console.cloud.google.com (enable Directions, Places, and Geocoding APIs). Free $200/month credit.');
  }

  const url = new URL(`https://maps.googleapis.com/maps/api/${endpoint}`);
  url.searchParams.set('key', apiKey);
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
      if (res.status === 403) throw new Error('Google Maps API key is invalid or restricted. Check your API key permissions at https://console.cloud.google.com');
      if (res.status === 429) throw new Error('Google Maps API rate limit exceeded. Try again in a few minutes.');
      throw new Error(`Google Maps API error (${res.status}): ${text}`);
    }
    const data = await res.json();
    if (data.status === 'REQUEST_DENIED') {
      throw new Error(`Google Maps API denied: ${data.error_message || 'Check API key and enabled APIs'}`);
    }
    return data;
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Google Maps API request timed out. Check your internet connection.');
    }
    throw err;
  }
}

// ─── Geocoding Helper ───

async function geocodeLocation(location: string): Promise<{ lat: number; lng: number } | null> {
  if (!location.trim()) return null;

  // Check settings cache first (for home location)
  const homeLoc = getSetting('home_location') || '';
  if (location.trim().toLowerCase() === homeLoc.toLowerCase()) {
    const cachedLat = getSetting('home_lat');
    const cachedLng = getSetting('home_lng');
    if (cachedLat && cachedLng && cachedLat !== '' && cachedLng !== '') {
      return { lat: parseFloat(cachedLat), lng: parseFloat(cachedLng) };
    }
  }

  // Check memory cache
  const cacheKey = `geocode:${location.toLowerCase().trim()}`;
  const cached = getCached(cacheKey, GEOCODE_CACHE_TTL_MS);
  if (cached) return cached as { lat: number; lng: number };

  try {
    const data = await fetchGoogleMapsAPI('geocode/json', { address: location }) as {
      status: string;
      results: Array<{ geometry: { location: { lat: number; lng: number } } }>;
    };

    if (data.status !== 'OK' || !data.results.length) return null;

    const coords = data.results[0].geometry.location;
    setCache(cacheKey, coords);

    // Persist home location coordinates
    if (location.trim().toLowerCase() === homeLoc.toLowerCase()) {
      setSetting('home_lat', String(coords.lat));
      setSetting('home_lng', String(coords.lng));
    }

    return coords;
  } catch {
    return null;
  }
}

// ─── get_traffic ───

registerTool('get_traffic', 'Check traffic and commute time to a destination. Use when asked about traffic, commute, or ETA.', async (args) => {
  const { from, to } = args as { from?: string; to?: string };

  const origin = (typeof from === 'string' && from.trim()) ? from.trim() : (getSetting('home_location') || '');
  const destination = (typeof to === 'string' && to.trim()) ? to.trim() : (getSetting('work_location') || '');

  if (!origin) {
    return { success: false, error: 'No origin specified and home_location not configured. Set your home location in settings or specify a "from" address.' };
  }
  if (!destination) {
    return { success: false, error: 'No destination specified and work_location not configured. Set your work location in settings or specify a "to" address.' };
  }

  const cacheKey = `traffic:${origin.toLowerCase()}:${destination.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return { success: true, data: cached };

  try {
    const data = await fetchGoogleMapsAPI('directions/json', {
      origin,
      destination,
      departure_time: 'now',
      traffic_model: 'best_guess',
    }) as {
      status: string;
      routes: Array<{
        summary: string;
        legs: Array<{
          distance: { text: string; value: number };
          duration: { text: string; value: number };
          duration_in_traffic?: { text: string; value: number };
          start_address: string;
          end_address: string;
        }>;
      }>;
    };

    if (data.status !== 'OK' || !data.routes.length) {
      return { success: false, error: `Could not find route from "${origin}" to "${destination}". Check the addresses.` };
    }

    const route = data.routes[0];
    const leg = route.legs[0];
    const normalDuration = leg.duration.value; // seconds
    const trafficDuration = leg.duration_in_traffic?.value || normalDuration;
    const delaySec = trafficDuration - normalDuration;

    let trafficStatus: string;
    if (delaySec <= 60) trafficStatus = 'clear';
    else if (delaySec <= 300) trafficStatus = 'light';
    else if (delaySec <= 900) trafficStatus = 'moderate';
    else trafficStatus = 'heavy';

    const result = {
      origin: leg.start_address,
      destination: leg.end_address,
      distance: leg.distance.text,
      normal_duration: leg.duration.text,
      traffic_duration: leg.duration_in_traffic?.text || leg.duration.text,
      delay_minutes: Math.round(delaySec / 60),
      traffic_status: trafficStatus,
      route_summary: route.summary,
    };

    setCache(cacheKey, result);

    const delayMsg = delaySec > 60 ? ` (+${Math.round(delaySec / 60)} min delay)` : '';
    return {
      success: true,
      data: result,
      message: `${result.origin} to ${result.destination}: ${result.traffic_duration}${delayMsg} via ${result.route_summary}. Distance: ${result.distance}. Traffic: ${result.traffic_status}.`,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Traffic check failed' };
  }
});

// ─── find_nearby ───

registerTool('find_nearby', 'Find restaurants, stores, or places nearby. Use for "near me", "closest", or "best [place] nearby" requests.', async (args) => {
  const { query, type, near, radius_miles = 5 } = args as {
    query?: string; type?: string; near?: string; radius_miles?: number;
  };

  if (!query && !type) {
    return { success: false, error: 'Specify what to search for (e.g., query: "pizza" or type: "restaurant")' };
  }

  // Determine search center
  const searchNear = (typeof near === 'string' && near.trim()) ? near.trim() : (getSetting('home_location') || '');
  if (!searchNear) {
    return { success: false, error: 'No location specified and home_location not configured. Set your home location in settings or specify a "near" address.' };
  }

  // Geocode the center point
  const coords = await geocodeLocation(searchNear);
  if (!coords) {
    return { success: false, error: `Could not find location: "${searchNear}". Try a more specific address.` };
  }

  const searchQuery = [query, type].filter(Boolean).join(' ');
  const radiusMeters = Math.min(Math.max(1, radius_miles), 30) * 1609; // miles to meters, cap at 30mi

  const cacheKey = `nearby:${searchQuery.toLowerCase()}:${coords.lat},${coords.lng}:${radiusMeters}`;
  const cached = getCached(cacheKey, 30 * 60 * 1000); // 30 min cache
  if (cached) return { success: true, data: cached };

  try {
    const params: Record<string, string> = {
      query: searchQuery,
      location: `${coords.lat},${coords.lng}`,
      radius: String(radiusMeters),
    };
    if (type) params.type = type;

    const data = await fetchGoogleMapsAPI('place/textsearch/json', params) as {
      status: string;
      results: Array<{
        name: string;
        formatted_address: string;
        rating?: number;
        user_ratings_total?: number;
        price_level?: number;
        opening_hours?: { open_now?: boolean };
        geometry: { location: { lat: number; lng: number } };
      }>;
    };

    if (data.status !== 'OK' || !data.results.length) {
      return { success: false, error: `No places found for "${searchQuery}" near ${searchNear}.` };
    }

    const places = data.results.slice(0, 5).map(p => ({
      name: p.name,
      address: p.formatted_address,
      rating: p.rating || null,
      reviews: p.user_ratings_total || 0,
      price_level: p.price_level != null ? '$'.repeat(p.price_level + 1) : null,
      open_now: p.opening_hours?.open_now ?? null,
    }));

    const result = { query: searchQuery, near: searchNear, count: places.length, places };
    setCache(cacheKey, result);

    const summary = places.map((p, i) => {
      const rating = p.rating ? ` (${p.rating}/5, ${p.reviews} reviews)` : '';
      const price = p.price_level ? ` ${p.price_level}` : '';
      const open = p.open_now === true ? ' - Open' : p.open_now === false ? ' - Closed' : '';
      return `${i + 1}. ${p.name}${rating}${price}${open}\n   ${p.address}`;
    }).join('\n');

    return {
      success: true,
      data: result,
      message: `Found ${places.length} places for "${searchQuery}" near ${searchNear}:\n${summary}`,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Places search failed' };
  }
});
