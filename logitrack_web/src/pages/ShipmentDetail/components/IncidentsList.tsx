import type { ShipmentIncident } from "../../../api/shipments";
import { INCIDENT_TYPE_LABELS } from "../../../api/shipments";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { fmtDateTime } from "../../../utils/date";
import { AlertTriangle } from "lucide-react";

interface IncidentsListProps {
  incidents: ShipmentIncident[];
}

export function IncidentsList({ incidents }: IncidentsListProps) {
  return (
    <Card className="mb-4 cursor-default">
      <CardHeader className="pb-3">
        <CardTitle>Incidencias</CardTitle>
      </CardHeader>
      <CardContent>
        {incidents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 gap-2">
            <AlertTriangle className="w-8 h-8 text-[var(--text-muted)] opacity-50" />
            <p className="text-[var(--text-muted)] text-[13px] m-0">Sin incidencias registradas.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 max-h-[320px] overflow-y-auto">
            {incidents.map((inc) => (
              <div
                key={inc.id}
                className="bg-[var(--warn-bg)] border border-[var(--warn-border)] rounded-lg p-3 text-[13px] transition-colors duration-200"
              >
                <div className="flex justify-between items-start mb-1.5">
                  <span className="font-bold text-[var(--warn-text)] bg-[var(--warn-bg)] border border-[var(--warn-border)] rounded-md px-2 py-0.5 text-[11px]">
                    {INCIDENT_TYPE_LABELS[inc.incident_type] ?? inc.incident_type}
                  </span>
                  <span className="text-[var(--text-muted)] text-[11px] whitespace-nowrap ml-2">
                    {fmtDateTime(inc.created_at)}
                  </span>
                </div>
                <p className="mt-1 mb-0 text-[var(--text-strong)] whitespace-pre-wrap">{inc.description}</p>
                <p className="mt-1.5 mb-0 text-[11px] text-[var(--text-muted)]">Reportado por: {inc.reported_by}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
