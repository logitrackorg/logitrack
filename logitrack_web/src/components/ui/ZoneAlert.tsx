import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { Zone } from "../../api/zones";

interface ZoneAlertProps {
  zones: Zone[];
  onDismissedChange?: (dismissed: boolean) => void;
}

export function ZoneAlert({ zones, onDismissedChange }: ZoneAlertProps) {
  const activeZones = zones.filter((z) => z.active);
  const [isDismissed, setIsDismissed] = useState(false);

  const zoneKey = activeZones.map((z) => z.id).join(",");
  useEffect(() => {
    if (activeZones.length > 0) setIsDismissed(false);
  }, [zoneKey]);

  useEffect(() => {
    onDismissedChange?.(isDismissed && activeZones.length > 0);
  }, [isDismissed, activeZones.length]);

  if (activeZones.length === 0 || isDismissed) return null;

  const first = activeZones[0];

  return (
    <div className="px-4 max-w-2xl mx-auto mb-2">
      <div className="flex items-center gap-2 bg-[var(--danger-bg)] border border-[var(--danger-border)] rounded-lg px-3 py-2">
        <AlertTriangle className="w-4 h-4 text-[var(--danger-c)] shrink-0" />
        <span className="text-xs font-semibold text-[var(--danger-text)] truncate flex-1">
          {first.name}
        </span>
        {activeZones.length > 1 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--danger-bg)] text-[var(--danger-text)] shrink-0">
            +{activeZones.length - 1}
          </span>
        )}
        <button
          onClick={() => setIsDismissed(true)}
          aria-label="Cerrar aviso"
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-[var(--danger-c)] opacity-60 hover:opacity-100 transition-opacity cursor-pointer border-0 bg-transparent"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
