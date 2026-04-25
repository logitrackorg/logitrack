import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { shipmentApi, type Shipment, type ShipmentStatus } from "../api/shipments";
import { branchApi, type Branch } from "../api/branches";
import { fmtDate } from "../utils/date";
import { StatusBadge } from "../components/StatusBadge";
import { PriorityBadge } from "../components/PriorityBadge";
import { useAuth } from "../context/AuthContext";

// Returns the corrected value if one exists, otherwise the original.
function corr(s: Shipment, key: string, fallback: string | number): string {
  const v = s.corrections?.[key];
  return v !== undefined ? v : String(fallback);
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function exportToCSV(shipments: Shipment[], branches: Branch[]) {
  const branchName = (id?: string) => {
    if (!id) return "";
    const b = branches.find((b) => b.id === id);
    return b ? `${b.name} — ${b.address.city}` : id;
  };

  const headers = [
    "ID de seguimiento", "Estado", "Prioridad",
    "Ciudad de origen", "Provincia de origen", "Ciudad de destino", "Provincia de destino",
    "Sucursal receptora", "Tipo de envío", "Peso (kg)", "Ubicación actual",
    "Creado", "Entrega estimada",
  ];

  const rows = shipments.map((s) => [
    s.status === "pending" ? "" : s.tracking_id,
    s.status,
    s.priority ?? "",
    corr(s, "origin_city", s.sender.address.city),
    s.sender.address.province,
    corr(s, "destination_city", s.recipient.address.city),
    s.recipient.address.province,
    branchName(s.receiving_branch_id),
    s.shipment_type ?? "",
    corr(s, "weight_kg", s.weight_kg),
    s.current_location ?? "",
    fmtDate(s.created_at),
    fmtDate(s.estimated_delivery_at),
  ].map(csvEscape).join(","));

  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `shipments_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

type StatusFilter = ShipmentStatus | "active" | "";

export function ShipmentList() {
  const [searchParams] = useSearchParams();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    (searchParams.get("status") as StatusFilter) ??
    (sessionStorage.getItem("shipment_status_filter") as StatusFilter) ??
    "active"
  );

  useEffect(() => {
    sessionStorage.setItem("shipment_status_filter", statusFilter);
  }, [statusFilter]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const { hasRole, user } = useAuth();
  const isOperator = user?.role === "operator";
  const hasBranchDefault = isOperator || user?.role === "supervisor";
  const [branchFilter, setBranchFilter] = useState(hasBranchDefault ? (user?.branch_id ?? "") : "");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const dateRangeInvalid = !!(dateFrom && dateTo && dateTo < dateFrom);

  const load = async (q?: string) => {
    setLoading(true);
    try {
      const data = q ? await shipmentApi.search(q) : await shipmentApi.list();
      setShipments(data ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { branchApi.listActive().then(setBranches).catch(() => {}); }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    load(query.trim() || undefined);
  };

  // Returns YYYY-MM-DD in local time for a given ISO timestamp
  const localDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const filtered = shipments.filter((s) => {
    if (statusFilter === "active" && (s.status === "delivered" || s.status === "pending" || s.status === "returned" || s.status === "cancelled")) return false;
    if (statusFilter !== "active" && statusFilter !== "" && s.status !== statusFilter) return false;
    if (branchFilter && s.receiving_branch_id !== branchFilter) return false;
    if (!dateRangeInvalid) {
      const created = localDate(s.created_at);
      if (dateFrom && created < dateFrom) return false;
      if (dateTo && created > dateTo) return false;
    }
    return true;
  });

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Envíos</h1>
        {hasRole("operator", "supervisor", "admin") && (
          <button onClick={() => navigate("/new")}
            style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontWeight: 600 }}>
            + Nuevo envío
          </button>
        )}
      </div>

      {/* Search & filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, flex: 1, minWidth: 240 }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por ID de seguimiento, remitente, destinatario o ciudad..."
            style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 }} />
          <button type="submit"
            style={{ background: "#4b5563", color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", cursor: "pointer" }}>
            Buscar
          </button>
          {query && (
            <button type="button" onClick={() => { setQuery(""); load(); }}
              style={{ background: "#e5e7eb", border: "none", borderRadius: 6, padding: "8px 12px", cursor: "pointer" }}>
              Limpiar
            </button>
          )}
        </form>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "#374151" }}>
          Desde
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={selectStyle} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "#374151" }}>
          Hasta
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            style={{ ...selectStyle, borderColor: dateRangeInvalid ? "#ef4444" : "#d1d5db" }} />
        </label>
        {dateRangeInvalid && (
          <span style={{ fontSize: 13, color: "#ef4444", alignSelf: "center" }}>
            La fecha "Hasta" debe ser posterior a "Desde"
          </span>
        )}
        {(dateFrom || dateTo) && (
          <button type="button" onClick={() => { setDateFrom(""); setDateTo(""); }}
            style={{ background: "#e5e7eb", border: "none", borderRadius: 6, padding: "8px 12px", cursor: "pointer", fontSize: 14 }}>
            Limpiar fechas
          </button>
        )}

        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          style={selectStyle}>
          <option value="active">Activos</option>
          <option value="">Todos</option>
          <option value="at_branch">En sucursal</option>
          <option value="cancelled">Cancelados</option>
          <option value="delivered">Entregados</option>
          <option value="delivery_failed">Entrega fallida</option>
          <option value="delivering">En reparto</option>
          <option value="pending">Borrador</option>
          <option value="in_progress">En proceso</option>
          <option value="pre_transit">Pre tránsito</option>
          <option value="in_transit">En tránsito</option>
          <option value="ready_for_pickup">Listo para retiro</option>
          <option value="ready_for_return">Listo para devolución</option>
          <option value="returned">Devueltos</option>
        </select>

        {isOperator ? (
          <span style={{ ...selectStyle, display: "inline-flex", alignItems: "center", background: "#f0f9ff", border: "1px solid #bfdbfe", color: "#1e3a5f", fontWeight: 500 }}>
            {branches.find(b => b.id === branchFilter)?.name ?? branchFilter}
          </span>
        ) : (
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} style={selectStyle}>
            <option value="">Todas las sucursales</option>
            {(() => {
              const byProvince = branches.reduce((acc, b) => {
                if (!acc[b.province]) acc[b.province] = [];
                acc[b.province].push(b);
                return acc;
              }, {} as Record<string, Branch[]>);
              return Object.entries(byProvince)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([province, pBranches]) => (
                  <optgroup key={province} label={province}>
                    {[...pBranches]
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(b => (
                        <option key={b.id} value={b.id}>{b.name} — {b.address.city}</option>
                      ))}
                  </optgroup>
                ));
            })()}
          </select>
        )}

      </div>

      {loading ? (
        <p>Cargando...</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: "#6b7280" }}>No se encontraron envíos.</p>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>{filtered.length} {filtered.length !== 1 ? "envíos" : "envío"}</p>
            {hasRole("admin", "manager") && (
              <button
                onClick={() => exportToCSV(filtered, branches)}
                style={{ background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
                Exportar CSV
              </button>
            )}
          </div>
          <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 800 }}>
            <thead>
              <tr style={{ background: "#f9fafb", textAlign: "left" }}>
                <th style={th}>ID de seguimiento</th>
                <th style={th}>Remitente</th>
                <th style={th}>Destinatario</th>
                <th style={th}>Origen → Destino</th>
                <th style={th}>Peso</th>
                <th style={th}>Prioridad</th>
                <th style={th}>Estado</th>
                <th style={th}>Creado</th>
                <th style={th}>Entrega estimada</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.tracking_id} onClick={() => navigate(`/shipments/${s.tracking_id}`)}
                  style={{ borderBottom: "1px solid #e5e7eb", cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f9ff")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                  <td style={td}><code>{s.status === "pending" ? <span style={{ color: "#9ca3af" }}>—</span> : s.tracking_id}</code></td>
                  <td style={td}>{corr(s, "sender_name", s.sender.name)}</td>
                  <td style={td}>{corr(s, "recipient_name", s.recipient.name)}</td>
                  <td style={td}>{corr(s, "origin_city", s.sender.address.city)} → {corr(s, "destination_city", s.recipient.address.city)}</td>
                  <td style={td}>{corr(s, "weight_kg", s.weight_kg)} kg</td>
                  <td style={td}><PriorityBadge priority={s.priority} /></td>
                  <td style={td}><StatusBadge status={s.status} /></td>
                  <td style={td}>{fmtDate(s.created_at)}</td>
                  <td style={td}>{fmtDate(s.estimated_delivery_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: "10px 14px", fontWeight: 600, color: "#374151" };
const td: React.CSSProperties = { padding: "10px 14px" };
const selectStyle: React.CSSProperties = { padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, background: "#fff" };
