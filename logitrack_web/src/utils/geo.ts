import type { Branch } from "../api/branches";

// Keep in sync with model.GeofenceRadiusMeters in the Go backend.
export const GEOFENCE_RADIUS_M = 300;

/** Haversine distance in meters between two WGS-84 coordinates. */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return haversineKm(lat1, lng1, lat2, lng2) * 1000;
}

// ---------------------------------------------------------------------------
// Overloaded haversine — supports both call signatures used across the codebase
// ---------------------------------------------------------------------------

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number;
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number;
export function haversineKm(
  aOrLat1: number | { lat: number; lng: number },
  bOrLng1: number | { lat: number; lng: number },
  lat2?: number,
  lng2?: number,
): number {
  if (typeof aOrLat1 === "object" && typeof bOrLng1 === "object") {
    const a = aOrLat1;
    const b = bOrLng1;
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.lat * Math.PI) / 180) *
        Math.cos((b.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(h));
  }

  // Flat-params signature: (lat1, lng1, lat2, lng2)
  const lat1 = aOrLat1 as number;
  const lng1 = bOrLng1 as number;
  const R = 6371;
  const dLat = (lat2! - lat1) * Math.PI / 180;
  const dLng = (lng2! - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2! * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function cityAbbrev(city: string): string {
  const map: Record<string, string> = {
    "Ciudad de Buenos Aires": "CABA",
    "Buenos Aires": "CABA",
    Córdoba: "CBA",
    Mendoza: "MZA",
    Rosario: "ROS",
    Salta: "SAL",
    Posadas: "POS",
    Jujuy: "JUJ",
    Bariloche: "BRC",
    Tucumán: "TUC",
  };
  const key = Object.keys(map).find((k) => city.toLowerCase().includes(k.toLowerCase()));
  return key ? map[key] : city.slice(0, 3).toUpperCase();
}

export function findFinalBranch(recipientAddress: { province?: string; latitude?: number; longitude?: number }, branches: Branch[]): Branch | null {
  const active = branches.filter(b => b.status === "activo");
  if (!active.length) return null;
  if (recipientAddress.latitude != null && recipientAddress.longitude != null) {
    let best: Branch | null = null;
    let minDist = Infinity;
    for (const b of active) {
      if (b.latitude != null && b.longitude != null) {
        const d = haversineKm(recipientAddress.latitude!, recipientAddress.longitude!, b.latitude, b.longitude);
        if (d < minDist) { minDist = d; best = b; }
      }
    }
    if (best) return best;
  }
  if (recipientAddress.province) {
    const match = active.find(b => b.province === recipientAddress.province);
    if (match) return match;
  }
  return null;
}
