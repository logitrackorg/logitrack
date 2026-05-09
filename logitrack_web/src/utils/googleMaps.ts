export interface GeoPoint {
  lat: number;
  lng: number;
}

export function googleMapsSingleStop(point: GeoPoint): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}&travelmode=driving`;
}

export function googleMapsRoute({
  origin,
  stops,
}: {
  origin?: GeoPoint;
  stops: GeoPoint[];
}): string {
  if (stops.length === 0) return "https://www.google.com/maps";

  const destination = stops[stops.length - 1];
  const intermediates = stops.slice(0, -1).slice(0, 9);

  const params = new URLSearchParams({
    api: "1",
    destination: `${destination.lat},${destination.lng}`,
    travelmode: "driving",
  });

  if (origin) params.set("origin", `${origin.lat},${origin.lng}`);
  if (intermediates.length > 0)
    params.set("waypoints", intermediates.map((p) => `${p.lat},${p.lng}`).join("|"));

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
