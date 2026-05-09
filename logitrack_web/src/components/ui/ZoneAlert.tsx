import { AlertTriangle } from "lucide-react";
import type { Zone } from "../../api/zones";

interface ZoneAlertProps {
  zones: Zone[];
}

export function ZoneAlert({ zones }: ZoneAlertProps) {
  const activeZones = zones.filter((z) => z.active);
  if (activeZones.length === 0) return null;

  const first = activeZones[0];

  return (
    <div className="zone-alert">
      <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
      <div className="zone-alert-content">
        <p className="zone-alert-title">ZONA PELIGROSA</p>
        <p className="zone-alert-desc">{first.name}{first.description ? ` — ${first.description}` : ""}</p>
      </div>
      {activeZones.length > 1 && (
        <span className="zone-alert-count">+{activeZones.length - 1}</span>
      )}
    </div>
  );
}
