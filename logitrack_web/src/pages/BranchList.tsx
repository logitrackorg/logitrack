import { useEffect, useState } from "react";
import { branchApi, type Branch, type CreateBranchPayload, type UpdateBranchPayload, statusLabel, statusColor } from "../api/branches";
import { useAuth } from "../context/AuthContext";
import { useIsMobile } from "../hooks/useIsMobile";
import { fmtDateTime } from "../utils/date";

const PROVINCES = [
  "Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes",
  "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza",
  "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis",
  "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán",
];

const STATUS_OPTIONS: { value: Branch["status"]; label: string }[] = [
  { value: "activo", label: "Active" },
  { value: "inactivo", label: "Inactive" },
  { value: "fuera_de_servicio", label: "Out of Service" },
];

type SortKey = "name" | "city" | "province" | "status" | "updated_at";

export function BranchList() {
  const isMobile = useIsMobile();
  const { hasRole } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [statusModal, setStatusModal] = useState<Branch | null>(null);
  const [error, setError] = useState("");

  const isAdmin = hasRole("admin");
  const isSupervisorOrAdmin = hasRole("supervisor", "admin");

  useEffect(() => { loadBranches(); }, []);

  const loadBranches = async () => {
    try {
      const data = await branchApi.list();
      setBranches(data);
    } catch {
      setError("Failed to load branches.");
    } finally {
      setLoading(false);
    }
  };

  const filtered = branches
    .filter((b) => {
      if (statusFilter && b.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          b.name.toLowerCase().includes(q) ||
          b.id.toLowerCase().includes(q) ||
          b.address.city.toLowerCase().includes(q) ||
          b.address.street.toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "city": cmp = a.address.city.localeCompare(b.address.city); break;
        case "province": cmp = (a.province || "").localeCompare(b.province || ""); break;
        case "status": cmp = a.status.localeCompare(b.status); break;
        case "updated_at": cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(); break;
      }
      return sortAsc ? cmp : -cmp;
    });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((p) => !p);
    else { setSortKey(key); setSortAsc(true); }
  };

  const sortIcon = (key: SortKey) => sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";

  return (
    <div style={{ padding: isMobile ? 16 : "24px 32px", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Branches</h1>
        {isAdmin && (
          <button onClick={() => { setShowCreate(true); setError(""); }}
            style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
            + New Branch
          </button>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <input
          style={{ flex: "1 1 200px", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 }}
          placeholder="Search by name, ID, city or address..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {error && <p style={{ color: "#ef4444", marginBottom: 12 }}>{error}</p>}

      {loading ? (
        <p style={{ color: "#6b7280" }}>Loading...</p>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: "#9ca3af" }}>
          <p style={{ fontSize: 18, fontWeight: 600 }}>No branches found</p>
          <p style={{ fontSize: 14 }}>
            {branches.length === 0 ? "There are no branches registered in the system." : "Try adjusting your search or filters."}
          </p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                <th style={thStyle}><button onClick={() => handleSort("name")} style={sortBtn}>Name{sortIcon("name")}</button></th>
                <th style={thStyle}><button onClick={() => handleSort("city")} style={sortBtn}>Location{sortIcon("city")}</button></th>
                <th style={isMobile ? { display: "none" } : thStyle}>Address</th>
                <th style={thStyle}><button onClick={() => handleSort("status")} style={sortBtn}>Status{sortIcon("status")}</button></th>
                <th style={isMobile ? { display: "none" } : thStyle}><button onClick={() => handleSort("updated_at")} style={sortBtn}>Updated{sortIcon("updated_at")}</button></th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600 }}>{b.name}</div>
                    <div style={{ fontSize: 11, color: "#9ca3af" }}>{b.id}</div>
                  </td>
                  <td style={tdStyle}>{b.address.city}, {b.province}</td>
                  <td style={isMobile ? { display: "none" } : tdStyle}>{b.address.street}</td>
                  <td style={tdStyle}>
                    <span style={{
                      display: "inline-block", padding: "2px 10px", borderRadius: 12,
                      fontSize: 12, fontWeight: 600, color: "#fff", background: statusColor(b.status),
                    }}>
                      {statusLabel(b.status)}
                    </span>
                  </td>
                  <td style={isMobile ? { display: "none" } : tdStyle}>
                    <div style={{ fontSize: 12 }}>{fmtDateTime(b.updated_at)}</div>
                    {b.updated_by && <div style={{ fontSize: 11, color: "#9ca3af" }}>by {b.updated_by}</div>}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: 6 }}>
                      {isAdmin && (
                        <button onClick={() => { setEditing(b); setError(""); }}
                          disabled={b.status !== "activo"}
                          style={{
                            ...actionBtn, opacity: b.status !== "activo" ? 0.4 : 1,
                          }}
                          title={b.status !== "activo" ? "Cannot edit inactive branch" : "Edit data"}
                        >
                          Edit
                        </button>
                      )}
                      {isSupervisorOrAdmin && (
                        <button onClick={() => { setStatusModal(b); setError(""); }}
                          style={actionBtn}>
                          Status
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <BranchFormModal
          title="New Branch"
          submitLabel="Create"
          onClose={() => setShowCreate(false)}
          onSubmit={async (data) => {
            await branchApi.create(data);
            setShowCreate(false);
            await loadBranches();
          }}
          error={error}
        />
      )}

      {/* Edit Modal */}
      {editing && (
        <BranchFormModal
          title="Edit Branch"
          submitLabel="Save"
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (data) => {
            await branchApi.update(editing.id, data);
            setEditing(null);
            await loadBranches();
          }}
          error={error}
        />
      )}

      {/* Status Modal */}
      {statusModal && (
        <StatusModal
          branch={statusModal}
          onClose={() => setStatusModal(null)}
          onSubmit={async (status) => {
            await branchApi.updateStatus(statusModal.id, status);
            setStatusModal(null);
            await loadBranches();
          }}
          error={error}
        />
      )}
    </div>
  );
}

// ─── Branch Form Modal (Create / Edit) ────────────────────────────────────────

function BranchFormModal({
  title, submitLabel, initial, onClose, onSubmit, error,
}: {
  title: string;
  submitLabel: string;
  initial?: Branch;
  onClose: () => void;
  onSubmit: (data: CreateBranchPayload | UpdateBranchPayload) => Promise<void>;
  error: string;
}) {
  const isEdit = !!initial;
  const [form, setForm] = useState({
    id: initial?.id ?? "",
    name: initial?.name ?? "",
    street: initial?.address.street ?? "",
    city: initial?.address.city ?? "",
    province: initial?.province ?? initial?.address.province ?? "",
    postal_code: initial?.address.postal_code ?? "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState("");

  const set = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setLocalError("Name is required."); return; }
    if (!form.street.trim()) { setLocalError("Street is required."); return; }
    if (!form.city.trim()) { setLocalError("City is required."); return; }
    if (!form.province) { setLocalError("Province is required."); return; }
    if (!form.postal_code.trim()) { setLocalError("Postal code is required."); return; }

    setSubmitting(true);
    setLocalError("");
    try {
      await onSubmit(form);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setLocalError(msg ?? "Operation failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h2 style={{ margin: "0 0 20px", fontSize: 18 }}>{title}</h2>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }}>
        {!isEdit && (
          <Field label="ID (optional — auto-generated if empty)">
            <input style={inputStyle} value={form.id} onChange={(e) => set("id", e.target.value)} placeholder="e.g. caba-02" />
          </Field>
        )}
        <Field label="Name *">
          <input style={inputStyle} required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. CDBA-02" />
        </Field>
        <Field label="Street *">
          <input style={inputStyle} required value={form.street} onChange={(e) => set("street", e.target.value)} placeholder="Av. Corrientes 1234" />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="City *">
            <input style={inputStyle} required value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Buenos Aires" />
          </Field>
          <Field label="Province *">
            <select style={inputStyle} required value={form.province} onChange={(e) => set("province", e.target.value)}>
              <option value="">Select...</option>
              {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Postal Code *">
          <input style={inputStyle} required value={form.postal_code} onChange={(e) => set("postal_code", e.target.value)} placeholder="C1043" />
        </Field>
        {(localError || error) && <p style={{ color: "#ef4444", margin: 0, fontSize: 13 }}>{localError || error}</p>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <button type="button" onClick={onClose} style={{ ...btnSecondary, opacity: submitting ? 0.5 : 1 }} disabled={submitting}>Cancel</button>
          <button type="submit" disabled={submitting} style={{ ...btnPrimary, opacity: submitting ? 0.7 : 1 }}>
            {submitting ? "Saving..." : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Status Modal ─────────────────────────────────────────────────────────────

function StatusModal({
  branch, onClose, onSubmit, error,
}: {
  branch: Branch;
  onClose: () => void;
  onSubmit: (status: Branch["status"]) => Promise<void>;
  error: string;
}) {
  const [status, setStatus] = useState(branch.status);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setLocalError("");
    try {
      await onSubmit(status);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setLocalError(msg ?? "Failed to update status.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h2 style={{ margin: "0 0 20px", fontSize: 18 }}>Change Status</h2>
      <div style={{ marginBottom: 16, padding: 12, background: "#f9fafb", borderRadius: 8 }}>
        <strong>{branch.name}</strong> <span style={{ color: "#9ca3af" }}>— {branch.address.city}</span>
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
          Current: <span style={{ color: statusColor(branch.status), fontWeight: 600 }}>{statusLabel(branch.status)}</span>
        </div>
      </div>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }}>
        <Field label="New Status">
          <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value as Branch["status"])}>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        {(localError || error) && <p style={{ color: "#ef4444", margin: 0, fontSize: 13 }}>{localError || error}</p>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} style={{ ...btnSecondary, opacity: submitting ? 0.5 : 1 }} disabled={submitting}>Cancel</button>
          <button type="submit" disabled={submitting} style={{ ...btnPrimary, opacity: submitting ? 0.7 : 1 }}>
            {submitting ? "Saving..." : "Update"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: 12, padding: "24px 28px", maxWidth: 520,
        width: "100%", maxHeight: "90vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
      }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>{label}</label>
      {children}
    </div>
  );
}

const thStyle: React.CSSProperties = { textAlign: "left", padding: "10px 12px", color: "#6b7280", fontWeight: 600, fontSize: 12, textTransform: "uppercase" as const, letterSpacing: 0.5 };
const tdStyle: React.CSSProperties = { padding: "10px 12px", verticalAlign: "middle" };
const sortBtn: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", color: "inherit", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, padding: 0 };
const actionBtn: React.CSSProperties = { background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 5, padding: "4px 10px", cursor: "pointer", fontSize: 12, fontWeight: 500 };
const inputStyle: React.CSSProperties = { padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, width: "100%", boxSizing: "border-box" as const };
const btnPrimary: React.CSSProperties = { background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", cursor: "pointer", fontWeight: 600, fontSize: 14 };
const btnSecondary: React.CSSProperties = { background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 18px", cursor: "pointer", fontWeight: 500, fontSize: 14 };
