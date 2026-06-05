import type { Branch } from "../api/branches";

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
