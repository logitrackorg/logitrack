// Coverage-radius slider bounds for the coverage simulator. Both the floor and
// the ceiling scale with the active analysis zone so small zones (e.g. CABA
// ~203 km²) keep a usable range instead of getting pinned at a fixed floor
// that's already near their 25 % ceiling.
//   min = 0.1 % of the zone (with a tiny absolute floor so it never hits 0)
//   max = 25 % of the zone (capped at SIM_AREA_MAX)
//
// Lives in its own module (not in CoverageSimulatorPanel) so both the panel and
// SlaTab's clamping effect share a single source of truth without tripping the
// react-refresh "only export components" rule.
export const SIM_AREA_MIN_RATIO = 0.0001; // 0.01 % of the zone
export const SIM_AREA_MAX_RATIO = 0.25; //  25 % of the zone
export const SIM_AREA_FLOOR = 10;
export const SIM_AREA_MAX = 1_000_000;
export const SIM_AREA_DEFAULT = 500_000;

// computeSimAreaBounds derives the {min, max, step} for the coverage-radius
// slider from the active zone's total area.
export function computeSimAreaBounds(zoneAreaKm2: number) {
  const min = Math.max(SIM_AREA_FLOOR, Math.round(zoneAreaKm2 * SIM_AREA_MIN_RATIO));
  const max = Math.max(min, Math.min(SIM_AREA_MAX, Math.round(zoneAreaKm2 * SIM_AREA_MAX_RATIO)));
  const step = Math.max(1, Math.round((max - min) / 1000));
  return { min, max, step };
}
