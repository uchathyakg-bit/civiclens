// Turns a ticket's location text into map coordinates, in the background, after the ticket is saved.
// Order: citizen's GPS (handled in store) → Nominatim (OpenStreetMap) → approximate city centre.
// Any failure (timeout, rate limit, offline) falls through to the next step; submissions never wait on this.

export const CITY = process.env.CIVICLENS_CITY || "Bengaluru";
export const CITY_CENTER = {
  lat: Number(process.env.CIVICLENS_CITY_LAT) || 12.9716,
  lng: Number(process.env.CIVICLENS_CITY_LNG) || 77.5946,
};
const ENABLED = process.env.CIVICLENS_GEOCODE !== "off";
const TIMEOUT_MS = 5000;
const GAP_MS = 1100; // Nominatim usage policy: max 1 request per second

const cache = new Map();
let chain = Promise.resolve();

// Spread approximate pins a little so they don't sit exactly on top of each other.
function approx(seed) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) | 0;
  const a = ((h >>> 0) % 360) * (Math.PI / 180);
  const r = 0.006 + ((h >>> 8) % 100) / 100 * 0.018;
  return { lat: CITY_CENTER.lat + Math.sin(a) * r, lng: CITY_CENTER.lng + Math.cos(a) * r, source: "approx", area: "" };
}

async function nominatim(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({ q: `${query}, ${CITY}`, format: "jsonv2", limit: "1", countrycodes: "in", addressdetails: "1" });
  const res = await fetch(url, {
    headers: { "User-Agent": "CivicLens-prototype/1.0 (hackathon demo)", "Accept-Language": "en" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const [hit] = await res.json();
  if (!hit) return null;
  const a = hit.address || {};
  return { lat: Number(hit.lat), lng: Number(hit.lon), source: "geocoded", area: a.suburb || a.neighbourhood || a.quarter || a.city_district || a.road || "" };
}

// Runs fn in the shared 1-request-per-second queue. Resolves to fallback on any error.
function queued(fn, fallback) {
  const job = chain.then(async () => {
    try { return await fn(); }
    catch (err) { console.warn(`[geocode] ${err.message}`); return fallback; }
    finally { await new Promise((r) => setTimeout(r, GAP_MS)); }
  });
  chain = job.catch(() => {});
  return job;
}

const shortAddress = (a = {}, fallback = "") =>
  [a.road || a.pedestrian || a.footway, a.neighbourhood || a.suburb || a.quarter, a.city_district || a.city || a.town]
    .filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(", ") || fallback;

/** Place search for the citizen's map picker. Never rejects; [] on failure. */
export function searchPlaces(q) {
  q = String(q || "").trim().slice(0, 120);
  if (!ENABLED || q.length < 3) return Promise.resolve([]);
  const key = `s:${q.toLowerCase()}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  return queued(async () => {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.search = new URLSearchParams({ q: /,/.test(q) ? q : `${q}, ${CITY}`, format: "jsonv2", limit: "5", countrycodes: "in", addressdetails: "1" });
    const res = await fetch(url, { headers: { "User-Agent": "CivicLens-prototype/1.0 (hackathon demo)", "Accept-Language": "en" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`search HTTP ${res.status}`);
    const out = (await res.json()).map((h) => ({ lat: Number(h.lat), lng: Number(h.lon), label: h.display_name.split(",").slice(0, 4).join(","), area: h.address?.suburb || h.address?.neighbourhood || "" }));
    const unique = out.filter((r, i) => out.findIndex((x) => x.label === r.label) === i);
    cache.set(key, unique);
    return unique;
  }, []);
}

/** Address for a dropped pin. Never rejects; null on failure. */
export function reverseGeocode(lat, lng) {
  if (!ENABLED) return Promise.resolve(null);
  const key = `r:${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  return queued(async () => {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.search = new URLSearchParams({ lat: String(lat), lon: String(lng), format: "jsonv2", zoom: "18", addressdetails: "1" });
    const res = await fetch(url, { headers: { "User-Agent": "CivicLens-prototype/1.0 (hackathon demo)", "Accept-Language": "en" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`reverse HTTP ${res.status}`);
    const h = await res.json();
    if (h.error) return null;
    const a = h.address || {};
    const out = { address: shortAddress(a, h.display_name?.split(",").slice(0, 3).join(",") || ""), area: a.suburb || a.neighbourhood || a.quarter || a.city_district || "" };
    cache.set(key, out);
    return out;
  }, null);
}

function cleanQuery(location) {
  return location.replace(/^(?:near|opposite|opp\.?|behind|beside|next to|in front of|at|on|in)\s+(?:the\s+)?/i, "").trim();
}

/** Resolves to {lat, lng, source, area}. Never rejects. */
export function geocode(location, seed) {
  const q = cleanQuery(location || "");
  if (!ENABLED || q.length < 3) return Promise.resolve(approx(seed));
  if (cache.has(q)) return Promise.resolve(cache.get(q) || approx(seed));
  // Try the full text first, then broader fallbacks: the last comma part (usually the area,
  // e.g. "4th Cross Malleshwaram") and the road after the last "on" ("… bus stop on MG Road").
  const parts = q.split(",").map((x) => x.trim()).filter(Boolean);
  const onRoad = q.match(/\bon\s+([A-Z0-9][^,]{2,40})$/)?.[1];
  const candidates = [...new Set([q, parts.length > 1 && parts.at(-1), onRoad].filter((x) => x && x.length >= 3))];
  const job = chain.then(async () => {
    for (const c of candidates) {
      try {
        const hit = await nominatim(c);
        if (hit) { cache.set(q, hit); return hit; }
      } catch (err) {
        console.warn(`[geocode] "${c}" failed (${err.message}); using approximate location`);
        return approx(seed); // service problem: don't hammer it, and don't cache (a later try may work)
      } finally {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
    }
    cache.set(q, null);
    return approx(seed);
  });
  chain = job.catch(() => {});
  return job;
}
