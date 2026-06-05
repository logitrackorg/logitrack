import { useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { formatCurrencyARS } from "../../../api/pricing";
import { GradientCard, GradientCardIcon, GradientCardLabel, GradientCardValue } from "../../../components/ui/gradient-card";
import type { PriceBreakdown } from "../../../api/shipments";

interface PriceCardProps {
  price: number;
  breakdown?: PriceBreakdown;
}

function PriceRow({ label, value }: { label: React.ReactNode; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-white/75 flex items-center gap-1">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function PriceCard({ price, breakdown }: PriceCardProps) {
  const [open, setOpen] = useState(false);
  return (
    <GradientCard tone="brand" className="mb-4">
      <div className="flex items-center gap-3 mb-3">
        <GradientCardIcon>
          <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </GradientCardIcon>
        <div className="flex-1 min-w-0">
          <GradientCardLabel>Precio del envío</GradientCardLabel>
          <GradientCardValue className="mt-0.5">{formatCurrencyARS(price)}</GradientCardValue>
        </div>
      </div>

      {breakdown && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="w-full bg-white/10 hover:bg-white/[0.18] border border-white/15 text-white rounded-lg px-3 py-2 cursor-pointer text-xs font-semibold flex items-center justify-between transition-colors"
          >
            <span>{open ? "Ocultar desglose" : "Ver desglose"}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>

          {open && (
            <div className="mt-3 pt-3 border-t border-white/15 grid gap-2 text-xs">
              <PriceRow label="Tarifa base" value={formatCurrencyARS(breakdown.base_fare)} />
              <PriceRow
                label={`Distancia (${breakdown.distance_km.toFixed(1)} km)`}
                value={formatCurrencyARS(breakdown.distance_cost)}
              />
              {breakdown.weight_surcharge > 0 && (
                <PriceRow label="Recargo por peso" value={formatCurrencyARS(breakdown.weight_surcharge)} />
              )}
              {breakdown.last_mile_surcharge > 0 && (
                <PriceRow label="Entrega a domicilio" value={formatCurrencyARS(breakdown.last_mile_surcharge)} />
              )}
              {breakdown.risky_zone_surcharge > 0 && (
                <PriceRow label={<><AlertTriangle className="w-3.5 h-3.5" /> Recargo zona peligrosa</>} value={formatCurrencyARS(breakdown.risky_zone_surcharge)} />
              )}
              {breakdown.shipment_multiplier !== 1 && (
                <PriceRow label="Tipo de envío (express)" value={formatCurrencyARS((breakdown.base_fare + breakdown.distance_cost) * (breakdown.shipment_multiplier - 1))} />
              )}
              {breakdown.time_window_surplus > 0 && (
                <PriceRow label="Recargo ventana horaria" value={formatCurrencyARS(breakdown.time_window_surplus)} />
              )}
              {breakdown.fragile_surplus > 0 && (
                <PriceRow label="Recargo frágil" value={formatCurrencyARS(breakdown.fragile_surplus)} />
              )}
              <div className="flex justify-between pt-2.5 mt-1 border-t border-white/15 font-bold text-[13px]">
                <span>Total</span>
                <span className="tabular-nums">{formatCurrencyARS(breakdown.total)}</span>
              </div>
            </div>
          )}
        </>
      )}
    </GradientCard>
  );
}
