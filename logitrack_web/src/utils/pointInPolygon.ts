import type { ZonePoint } from "../api/zones";

export function pointInPolygon(lat: number, lng: number, polygon: ZonePoint[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  let inside = false;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

export function isInDangerZone(lat: number, lng: number, zones: Array<{ active: boolean; polygon: ZonePoint[] }>): boolean {
  return zones.some((z) => z.active && pointInPolygon(lat, lng, z.polygon));
}
