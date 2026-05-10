import type { Branch } from "../api/branches";

// Province centroid coordinates — mirrors backend ml/dataset.go ProvinceCoords.
const PROVINCE_COORDS: Record<string, [number, number]> = {
  "Buenos Aires": [-36.6767, -60.5581],
  "Ciudad de Buenos Aires": [-34.6037, -58.3816],
  "Catamarca": [-28.4696, -65.7795],
  "Chaco": [-27.4515, -59.0255],
  "Chubut": [-43.2935, -65.1115],
  "Córdoba": [-31.4135, -64.1811],
  "Corrientes": [-27.4692, -58.8306],
  "Entre Ríos": [-31.7746, -60.4958],
  "Formosa": [-26.1849, -58.1731],
  "Jujuy": [-24.1858, -65.2995],
  "La Pampa": [-36.6167, -64.2833],
  "La Rioja": [-29.4131, -66.8558],
  "Mendoza": [-32.8908, -68.8272],
  "Misiones": [-27.4269, -55.9461],
  "Neuquén": [-38.9516, -68.0591],
  "Río Negro": [-40.8135, -63.0004],
  "Salta": [-24.7821, -65.4232],
  "San Juan": [-31.5375, -68.5364],
  "San Luis": [-33.2951, -66.3356],
  "Santa Cruz": [-51.6352, -69.2473],
  "Santa Fe": [-31.6107, -60.6970],
  "Santiago del Estero": [-27.7834, -64.2642],
  "Tierra del Fuego": [-54.8019, -68.3030],
  "Tucumán": [-26.8241, -65.2226],
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.asin(Math.sqrt(a));
}

function branchCoords(b: Branch): [number, number] | null {
  if (b.latitude != null && b.longitude != null) return [b.latitude, b.longitude];
  const coords = PROVINCE_COORDS[b.province];
  return coords ?? null;
}

// Returns the ID of the nearest active branch to the given coordinates.
export function nearestBranch(lat: number, lng: number, branches: Branch[]): string {
  let bestId = "";
  let bestDist = Infinity;
  for (const b of branches) {
    if (b.status !== "activo") continue;
    const bc = branchCoords(b);
    if (!bc) continue;
    const d = haversineKm(lat, lng, bc[0], bc[1]);
    if (d < bestDist) {
      bestDist = d;
      bestId = b.id;
    }
  }
  return bestId;
}

// Resolves the nearest active branch for a recipient address.
// Uses lat/lng when available, falls back to province centroid.
export function resolveFinalBranch(
  address: { latitude?: number; longitude?: number; province?: string },
  branches: Branch[]
): string {
  if (address.latitude != null && address.longitude != null) {
    return nearestBranch(address.latitude, address.longitude, branches);
  }
  if (address.province) {
    const coords = PROVINCE_COORDS[address.province];
    if (coords) return nearestBranch(coords[0], coords[1], branches);
  }
  return "";
}
