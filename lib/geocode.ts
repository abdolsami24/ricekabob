// Geocoding (free OpenStreetMap Nominatim) + haversine distance,
// used to price delivery by straight-line distance from the restaurant.

export function restaurantCoords(): { lat: number; lng: number } {
  const lat = Number(process.env.RESTAURANT_LAT ?? "39.65987");
  const lng = Number(process.env.RESTAURANT_LNG ?? "-104.85051");
  return {
    lat: Number.isFinite(lat) ? lat : 39.65987,
    lng: Number.isFinite(lng) ? lng : -104.85051,
  };
}

/** Straight-line distance in miles (haversine, Earth radius 3958.8 mi). */
export function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Geocodes a US address with Nominatim. Returns {lat, lng} or null when the
 * address cannot be found. Times out after about 6 seconds.
 */
export async function geocodeAddress(
  address: string
): Promise<{ lat: number; lng: number } | null> {
  const q = address.trim();
  if (q.length < 6) return null;
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=" +
    encodeURIComponent(q);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "MadinahMarketWebsite/1.0 (owner contact: Abdolsami@yahoo.com)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { lat?: string; lon?: string }[];
    if (!Array.isArray(data) || data.length === 0) return null;
    const lat = Number(data[0].lat);
    const lng = Number(data[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Full quote: geocode + distance + fee band. */
export async function quoteDelivery(
  address: string
): Promise<
  | { ok: true; miles: number; fee_cents: number; label: string }
  | { ok: false; error: "far" | "not_found" }
> {
  const { deliveryFeeForMiles } = await import("./pricing");
  const geo = await geocodeAddress(address);
  if (!geo) return { ok: false, error: "not_found" };
  const r = restaurantCoords();
  const miles = milesBetween(r.lat, r.lng, geo.lat, geo.lng);
  const band = deliveryFeeForMiles(miles);
  if (!band) return { ok: false, error: "far" };
  return {
    ok: true,
    miles: Math.round(miles * 100) / 100,
    fee_cents: band.fee_cents,
    label: `within ${band.band_miles} mile${band.band_miles === 1 ? "" : "s"}`,
  };
}
