import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileText, Search, X, ArrowUpDown, ChevronRight, Filter, Clock, AlertTriangle,
} from "lucide-react";
import { shipmentApi, type Shipment } from "../api/shipments";
import { systemConfigApi } from "../api/systemConfig";
import { clockApi } from "../api/clock";
import { fmtDateTime } from "../utils/date";
import { PageHeader } from "../components/ui/page-header";
import { Card } from "../components/ui/card";
import { useAuth } from "../context/AuthContext";

type SortOrder = "oldest" | "newest";

const inputClass =
  "h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-[3px] focus:ring-[#2563eb]/20 focus:border-[#2563eb] transition-all";

/** Returns a human-readable label for the time remaining until a draft expires. */
function formatTimeLeft(createdAt: string, retentionDays: number, nowMs: number): {
  label: string;
  urgent: boolean; // true when ≤ 2 days left
} {
  const expiresAt = new Date(new Date(createdAt).getTime() + retentionDays * 24 * 60 * 60 * 1000);
  const msLeft = expiresAt.getTime() - nowMs;

  if (msLeft <= 0) return { label: "Vencido", urgent: true };

  const hoursLeft = Math.floor(msLeft / (1000 * 60 * 60));
  const daysLeft  = Math.floor(hoursLeft / 24);

  if (daysLeft === 0) {
    return { label: hoursLeft <= 1 ? "Vence en menos de 1 h" : `Vence en ${hoursLeft} h`, urgent: true };
  }
  if (daysLeft === 1) return { label: "Vence mañana", urgent: true };
  return { label: `Vence en ${daysLeft} días`, urgent: daysLeft <= 2 };
}

export function DraftList() {
  const [drafts, setDrafts] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(false);
  const [retentionDays, setRetentionDays] = useState<number>(7);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [query, setQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("oldest");
  const navigate = useNavigate();
  const { hasRole } = useAuth();

  const fetchClock = () =>
    clockApi.get()
      .then((c) => setNowMs(new Date(c.system_now).getTime()))
      .catch(() => setNowMs(Date.now()));

  useEffect(() => {
    setLoading(true);
    Promise.all([
      shipmentApi.list().then((all) => (all ?? []).filter((s) => s.status === "draft")),
      systemConfigApi.get().catch(() => null),
      clockApi.get().catch(() => null),
    ])
      .then(([draftList, cfg, clock]) => {
        setDrafts(draftList);
        if (cfg?.draft_retention_days) setRetentionDays(cfg.draft_retention_days);
        // Use the server clock (may be overridden for testing) as "now"
        setNowMs(clock?.system_now ? new Date(clock.system_now).getTime() : Date.now());
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Re-sync the clock whenever the tab regains focus (e.g. after setting override in another tab)
    const onVisible = () => { if (document.visibilityState === "visible") fetchClock(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const expiresAtMs = (d: { created_at: string }) =>
    new Date(d.created_at).getTime() + retentionDays * 24 * 60 * 60 * 1000;

  // Hide drafts that have already passed their expiration window according to
  // the server clock. The nightly job will eventually flip them to 'expired'
  // in the DB, but in the meantime they should be invisible to operators.
  const visibleDrafts = drafts.filter((d) => expiresAtMs(d) > nowMs);

  const filtered = visibleDrafts
    .filter((d) => {
      const q = query.trim().toLowerCase();
      if (q.length < 2) return true;
      const sender = (d.sender?.name ?? "").toLowerCase();
      const recipient = (d.recipient?.name ?? "").toLowerCase();
      const senderCity = (d.sender?.address?.city ?? "").toLowerCase();
      const recipientCity = (d.recipient?.address?.city ?? "").toLowerCase();
      return (
        sender.includes(q) ||
        recipient.includes(q) ||
        senderCity.includes(q) ||
        recipientCity.includes(q) ||
        d.tracking_id.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const diff =
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return sortOrder === "oldest" ? diff : -diff;
    });

  return (
    <div className="p-6 max-w-[1000px] mx-auto">
      <PageHeader
        title="Borradores"
        description="Envíos guardados sin confirmar"
        icon={<FileText className="w-5 h-5" />}
        actions={
          hasRole("operator", "supervisor") ? (
            <button
              onClick={() => navigate("/new")}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#1e3a5f] hover:bg-[#15294a] text-white text-sm font-semibold transition-colors shadow-sm cursor-pointer"
            >
              Nuevo envío
            </button>
          ) : undefined
        }
      />

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap gap-3 items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-[260px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por remitente, destinatario o ciudad…"
              className={`${inputClass} w-full pl-9`}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Sort */}
          <div className="flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4 text-slate-400 shrink-0" />
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as SortOrder)}
              className={inputClass}
            >
              <option value="oldest">Más antiguo al más reciente</option>
              <option value="newest">Más reciente al más antiguo</option>
            </select>
          </div>
        </div>
      </Card>

      {/* List */}
      {loading ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-slate-500">Cargando…</p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center">
          <Filter className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">
            {visibleDrafts.length === 0
              ? "No hay borradores guardados."
              : "No se encontraron borradores con ese criterio de búsqueda."}
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-100 bg-slate-50/50">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {filtered.length}{" "}
              {filtered.length === 1 ? "borrador" : "borradores"}
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {filtered.map((d) => {
              const { label: timeLabel, urgent } = formatTimeLeft(d.created_at, retentionDays, nowMs);
              return (
                <button
                  key={d.tracking_id}
                  type="button"
                  onClick={() => navigate(`/shipments/${d.tracking_id}`)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors text-left cursor-pointer group"
                >
                  {/* Icon */}
                  <div className="w-9 h-9 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-amber-500" />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-semibold text-slate-900 truncate">
                        {d.sender?.name || "Sin remitente"}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                      <span className="text-slate-700 truncate">
                        {d.recipient?.name || "Sin destinatario"}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                      {d.sender?.address?.city && d.recipient?.address?.city && (
                        <>
                          <span>{d.sender.address.city}</span>
                          <span className="text-slate-200">→</span>
                          <span>{d.recipient.address.city}</span>
                          <span className="text-slate-200">·</span>
                        </>
                      )}
                      <span>{fmtDateTime(d.created_at)}</span>
                      {d.weight_kg > 0 && (
                        <>
                          <span className="text-slate-200">·</span>
                          <span>{d.weight_kg} kg</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Time left badge + CTA */}
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md ${
                        urgent
                          ? "bg-rose-50 text-rose-600 border border-rose-200"
                          : "bg-slate-100 text-slate-500 border border-slate-200"
                      }`}
                    >
                      {urgent
                        ? <AlertTriangle className="w-3 h-3" />
                        : <Clock className="w-3 h-3" />}
                      {timeLabel}
                    </span>
                    <span className="text-xs font-semibold text-[#2563eb] group-hover:underline">
                      Retomar →
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
