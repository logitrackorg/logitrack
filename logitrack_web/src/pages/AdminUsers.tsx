import { useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import { AddressAutocomplete } from "../components/AddressAutocomplete";
import { adminApi, type UserUpdatePayload, type UserCreatePayload } from "../api/admin";
import { branchApi, type Branch } from "../api/branches";
import type { User, Role, UserStatus, UserAddress } from "../api/auth";
import { fmtDateTime } from "../utils/date";
import { useAuth } from "../context/AuthContext";
import { TopbarActions } from "../components/topbarContext";
import { Card } from "../components/ui/card";

const ROLES: Role[] = ["operator", "supervisor", "driver", "manager", "admin"];
const ROLES_WITH_BRANCH: Role[] = ["operator", "supervisor", "driver"];

type DriverType = "ultima_milla" | "intersucursal";

const roleLabel: Record<Role, string> = {
  operator: "Operador",
  supervisor: "Supervisor",
  driver: "Chofer",
  manager: "Gerente",
  admin: "Admin",
};

const driverTypeLabel: Record<DriverType, string> = {
  ultima_milla: "Última milla",
  intersucursal: "Intersucursal",
};

function userDisplayLabel(u: User): string {
  if (u.role === "driver" && u.driver_type) {
    return `Chofer · ${driverTypeLabel[u.driver_type as DriverType] ?? u.driver_type}`;
  }
  return roleLabel[u.role] ?? u.role;
}

const roleBadgeColor: Record<Role, string> = {
  operator: "#3b82f6",
  supervisor: "#8b5cf6",
  driver: "#f59e0b",
  manager: "#10b981",
  admin: "#ef4444",
};

const ARGENTINA_PROVINCES = [
  "Buenos Aires", "Ciudad Autónoma de Buenos Aires", "Catamarca", "Chaco", "Chubut",
  "Córdoba", "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja",
  "Mendoza", "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis",
  "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán",
];

interface EditState {
  first_name: string;
  last_name: string;
  email: string;
  role: Role;
  branch_id: string;
  status: UserStatus;
  address: UserAddress;
}

interface CreateState {
  username: string;
  password: string;
  first_name: string;
  last_name: string;
  email: string;
  role: Role;
  branch_id: string;
  driver_type: DriverType | "";
  address: UserAddress;
}

const emptyAddress = (): UserAddress => ({ street: "", city: "", province: "", postal_code: "" });

const emptyCreate = (): CreateState => ({
  username: "", password: "", first_name: "", last_name: "", email: "",
  role: "operator", branch_id: "", driver_type: "", address: emptyAddress(),
});

const reEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const reName = /^[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ\s'-]+$/;
const reUsername = /^[a-zA-Z0-9_-]+$/;
const rePostal = /^[A-Z0-9]{4,10}$/i;

function validatePersonalFields(s: { first_name: string; last_name: string; email: string; address: UserAddress }): string {
  if (!s.first_name.trim()) return "El nombre es obligatorio.";
  if (!reName.test(s.first_name.trim())) return "El nombre solo puede contener letras y espacios.";
  if (!s.last_name.trim()) return "El apellido es obligatorio.";
  if (!reName.test(s.last_name.trim())) return "El apellido solo puede contener letras y espacios.";
  if (!s.email.trim()) return "El email es obligatorio.";
  if (!reEmail.test(s.email.trim())) return "El email no tiene un formato válido (ej. usuario@dominio.com).";
  if (!s.address.street?.trim()) return "La calle y número son obligatorios.";
  if (!s.address.city.trim()) return "La ciudad es obligatoria.";
  if (!s.address.province.trim()) return "La provincia es obligatoria.";
  if (!s.address.postal_code?.trim()) return "El código postal es obligatorio.";
  if (!rePostal.test(s.address.postal_code!.trim())) return "El código postal debe tener entre 4 y 10 caracteres alfanuméricos (ej. C1043, 5000).";
  return "";
}

export function AdminUsers() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editDriverType, setEditDriverType] = useState<DriverType | "">("");
  const [editState, setEditState] = useState<EditState>({
    first_name: "", last_name: "", email: "",
    role: "operator", branch_id: "", status: "activo", address: emptyAddress(),
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateState>(emptyCreate());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "">("");
  const [driverTypeFilter, setDriverTypeFilter] = useState<DriverType | "">("");
  const [statusFilter, setStatusFilter] = useState<UserStatus | "">("");

  const load = async () => {
    setLoading(true);
    try {
      const [u, b] = await Promise.all([adminApi.listUsers(), branchApi.list()]);
      setUsers(u);
      setBranches(b);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openEdit = (u: User) => {
    setEditingUser(u);
    setEditDriverType((u.driver_type as DriverType) ?? "");
    setEditState({
      first_name: u.first_name ?? "",
      last_name: u.last_name ?? "",
      email: u.email ?? "",
      role: u.role,
      branch_id: u.branch_id ?? "",
      status: u.status ?? "activo",
      address: u.address ? { ...u.address } : emptyAddress(),
    });
    setSaveError("");
  };
  const closeEdit = () => { setEditingUser(null); setSaveError(""); };

  const handleSave = async () => {
    if (!editingUser) return;
    if (ROLES_WITH_BRANCH.includes(editState.role) && !editState.branch_id) {
      setSaveError("La sucursal es obligatoria para este rol.");
      return;
    }
    if (editState.role === "driver" && !editDriverType) {
      setSaveError("El tipo de chofer es obligatorio.");
      return;
    }
    const validErr = validatePersonalFields(editState);
    if (validErr) { setSaveError(validErr); return; }

    setSaving(true); setSaveError("");
    try {
      const payload: UserUpdatePayload = {
        first_name: editState.first_name,
        last_name: editState.last_name,
        email: editState.email,
        address: editState.address,
      };
      if (editState.role !== editingUser.role) payload.role = editState.role;
      if (editState.branch_id !== (editingUser.branch_id ?? "")) payload.branch_id = editState.branch_id;
      if (editState.status !== (editingUser.status ?? "activo")) payload.status = editState.status;
      if (editState.role === "driver") payload.driver_type = editDriverType || null;

      const updated = await adminApi.updateUser(editingUser.id, payload);
      setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
      closeEdit();
    } catch (e: unknown) {
      setSaveError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "No se pudo guardar.");
    } finally { setSaving(false); }
  };

  const handleCreate = async () => {
    if (ROLES_WITH_BRANCH.includes(createForm.role) && !createForm.branch_id) {
      setCreateError("La sucursal es obligatoria para este rol.");
      return;
    }
    if (createForm.role === "driver" && !createForm.driver_type) {
      setCreateError("El tipo de chofer es obligatorio.");
      return;
    }
    if (!createForm.username.trim()) { setCreateError("El nombre de usuario es obligatorio."); return; }
    if (!reUsername.test(createForm.username.trim())) { setCreateError("El nombre de usuario solo puede contener letras, números, guiones y guiones bajos."); return; }
    if (!createForm.password.trim()) { setCreateError("La contraseña es obligatoria."); return; }
    const validErr = validatePersonalFields(createForm);
    if (validErr) { setCreateError(validErr); return; }

    setCreating(true); setCreateError("");
    try {
      const payload: UserCreatePayload = {
        username: createForm.username,
        password: createForm.password,
        role: createForm.role,
        first_name: createForm.first_name,
        last_name: createForm.last_name,
        email: createForm.email,
        address: createForm.address,
      };
      if (ROLES_WITH_BRANCH.includes(createForm.role)) payload.branch_id = createForm.branch_id;
      if (createForm.role === "driver" && createForm.driver_type) payload.driver_type = createForm.driver_type;
      const newUser = await adminApi.createUser(payload);
      setUsers(prev => [...prev, newUser]);
      setShowCreate(false);
      setCreateForm(emptyCreate());
    } catch (e: unknown) {
      setCreateError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "No se pudo crear el usuario.");
    } finally { setCreating(false); }
  };

  const branchName = (id: string) => branches.find(b => b.id === id)?.name ?? id;

  const filtered = users.filter(u => {
    if (roleFilter && u.role !== roleFilter) return false;
    if (driverTypeFilter && (u.role !== "driver" || u.driver_type !== driverTypeFilter)) return false;
    if (statusFilter && (u.status ?? "activo") !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const fullName = `${u.first_name ?? ""} ${u.last_name ?? ""}`.toLowerCase();
      if (!u.username.toLowerCase().includes(q) && !fullName.includes(q) && !(u.email ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const sortedBranches = [...branches].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <TopbarActions>
        <button
          onClick={() => { setShowCreate(true); setCreateError(""); setCreateForm(emptyCreate()); }}
          className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg bg-[var(--sidebar-bg)] hover:bg-[#15294a] text-white text-sm font-semibold transition-colors shadow-sm cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Nuevo usuario
        </button>
      </TopbarActions>

      <Card className="mb-4 p-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por usuario, nombre o email…"
            className="w-full pl-9 h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm placeholder:text-slate-400 focus:outline-none focus:ring-[3px] focus:ring-[var(--brand)]/20 focus:border-[var(--brand)]"
          />
        </div>
        <select
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value as Role | "")}
          className="h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-[3px] focus:ring-[var(--brand)]/20 focus:border-[var(--brand)]"
        >
          <option value="">Todos los roles</option>
          {ROLES.map(r => <option key={r} value={r}>{roleLabel[r]}</option>)}
        </select>
        {roleFilter === "driver" && (
          <select
            value={driverTypeFilter}
            onChange={e => setDriverTypeFilter(e.target.value as DriverType | "")}
            className="h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-[3px] focus:ring-[var(--brand)]/20 focus:border-[var(--brand)]"
          >
            <option value="">Todos los choferes</option>
            <option value="ultima_milla">Última milla</option>
            <option value="intersucursal">Intersucursal</option>
          </select>
        )}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as UserStatus | "")}
          className="h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-[3px] focus:ring-[var(--brand)]/20 focus:border-[var(--brand)]"
        >
          <option value="">Todos los estados</option>
          <option value="activo">Activo</option>
          <option value="inactivo">Inactivo</option>
        </select>
        {(search || roleFilter || driverTypeFilter || statusFilter) && (
          <button
            onClick={() => { setSearch(""); setRoleFilter(""); setDriverTypeFilter(""); setStatusFilter(""); }}
            className="text-xs text-slate-500 hover:text-slate-700 underline cursor-pointer"
          >
            Limpiar
          </button>
        )}
        <span className="ml-auto text-xs font-semibold text-slate-500 uppercase tracking-wider">
          {filtered.length} usuario{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>
      </Card>

      {loading ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-slate-500">Cargando…</p>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm min-w-[700px]">
            <thead>
              <tr className="bg-[var(--bg-subtle)] text-left">
                {["ID", "Nombre", "Usuario", "Rol", "Sucursal", "Estado", ""].map(h => (
                  <th key={h} className="px-[14px] py-[10px] border-b-2 border-[var(--border)] font-semibold text-[var(--text-strong)] text-[13px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => {
                const isInactive = (u.status ?? "activo") === "inactivo";
                return (
                  <tr key={u.id} className={`border-b border-[var(--border)] ${isInactive ? "opacity-65" : ""} hover:bg-[var(--bg-subtle)] transition-colors`}>
                    <td className="px-[14px] py-[10px] text-[var(--text-muted)] text-xs">{u.id}</td>
                    <td className="px-[14px] py-[10px]">
                      <div className="font-semibold text-[var(--text-primary)]">
                        {u.first_name || u.last_name ? `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() : <span className="text-[var(--text-muted)] italic">—</span>}
                      </div>
                      {u.email && <div className="text-xs text-[var(--text-secondary)]">{u.email}</div>}
                    </td>
                    <td className="px-[14px] py-[10px] text-[var(--text-strong)]">{u.username}</td>
                    <td className="px-[14px] py-[10px]">
                      <span className="inline-block rounded-full text-xs font-semibold px-2.5 py-0.5" style={{ background: `${roleBadgeColor[u.role]}18`, color: roleBadgeColor[u.role] }}>
                        {userDisplayLabel(u)}
                      </span>
                    </td>
                    <td className="px-[14px] py-[10px]">
                      {u.branch_id
                        ? <span className="bg-[var(--brand-tint)] border border-[var(--brand-tint-border)] rounded-md px-2 py-0.5 text-xs text-[var(--text-heading)]">{branchName(u.branch_id)}</span>
                        : <span className="text-[var(--text-muted)] italic">—</span>}
                    </td>
                    <td className="px-[14px] py-[10px]">
                      <StatusBadge status={u.status ?? "activo"} />
                    </td>
                    <td className="px-[14px] py-[10px] text-right">
                      <button onClick={() => openEdit(u)}
                        className="bg-transparent border border-[var(--border-strong)] rounded-md px-3 py-1 cursor-pointer text-[13px] text-[var(--text-strong)] font-medium hover:bg-[var(--bg-muted)] transition-colors">
                        Editar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit modal */}
      {editingUser && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={closeEdit}>
          <div style={{ background: "var(--bg-card)", borderRadius: 12, padding: 28, width: 520, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: "1.05rem", color: "var(--text-heading)" }}>Editar usuario</h2>
              <button onClick={closeEdit} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--text-secondary)" }}>✕</button>
            </div>

            <div style={{ background: "var(--bg-page)", borderRadius: 8, padding: "8px 14px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Usuario:</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-heading)", fontFamily: "monospace" }}>{editingUser.username}</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>ID #{editingUser.id}</span>
            </div>

            <SectionTitle>Datos de acceso</SectionTitle>
            <div style={{ display: "grid", gap: 14, marginBottom: 20 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={labelStyle}>
                  Rol *
                  <select value={editState.role}
                    disabled={editingUser?.id === currentUser?.id}
                    onChange={e => {
                      const newRole = e.target.value as Role;
                      if (newRole !== "driver") setEditDriverType("");
                      setEditState(s => ({ ...s, role: newRole, branch_id: ROLES_WITH_BRANCH.includes(newRole) ? s.branch_id : "" }));
                    }}
                    style={{ ...inputStyle, ...(editingUser?.id === currentUser?.id ? { opacity: 0.6, cursor: "not-allowed" } : {}) }}>
                    {ROLES.map(r => <option key={r} value={r}>{roleLabel[r]}</option>)}
                  </select>
                  {editingUser?.id === currentUser?.id && (
                    <span style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4, display: "block" }}>No podés modificar tu propio rol.</span>
                  )}
                </label>
                <label style={labelStyle}>
                  Estado *
                  <select value={editState.status} onChange={e => setEditState(s => ({ ...s, status: e.target.value as UserStatus }))} style={inputStyle}>
                    <option value="activo">Activo</option>
                    <option value="inactivo">Inactivo</option>
                  </select>
                </label>
              </div>
              {ROLES_WITH_BRANCH.includes(editState.role) && (
                <label style={labelStyle}>
                  Sucursal asignada *
                  <select value={editState.branch_id} onChange={e => setEditState(s => ({ ...s, branch_id: e.target.value }))} style={inputStyle}>
                    <option value="">— Seleccionar sucursal —</option>
                    {sortedBranches.map(b => <option key={b.id} value={b.id}>{b.name} — {b.address.city}</option>)}
                  </select>
                </label>
              )}
              {editState.role === "driver" && (
                <label style={labelStyle}>
                  Tipo de chofer *
                  <select value={editDriverType} onChange={e => setEditDriverType(e.target.value as DriverType | "")} style={inputStyle}>
                    <option value="">— Seleccionar tipo —</option>
                    <option value="ultima_milla">Última milla</option>
                    <option value="intersucursal">Intersucursal</option>
                  </select>
                </label>
              )}
            </div>

            <SectionTitle>Datos personales</SectionTitle>
            <div style={{ display: "grid", gap: 14, marginBottom: 20 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={labelStyle}>
                  Nombre *
                  <input value={editState.first_name} onChange={e => setEditState(s => ({ ...s, first_name: e.target.value }))} style={inputStyle} />
                </label>
                <label style={labelStyle}>
                  Apellido *
                  <input value={editState.last_name} onChange={e => setEditState(s => ({ ...s, last_name: e.target.value }))} style={inputStyle} />
                </label>
              </div>
              <label style={labelStyle}>
                Email *
                <input type="email" value={editState.email} onChange={e => setEditState(s => ({ ...s, email: e.target.value }))} placeholder="usuario@ejemplo.com" style={inputStyle} />
              </label>
            </div>

            <SectionTitle>Domicilio</SectionTitle>
            <div style={{ display: "grid", gap: 14, marginBottom: 20 }}>
              <label style={labelStyle}>
                Calle y número *
                <AddressAutocomplete style={inputStyle} value={editState.address.street ?? ""}
                  onChange={(v) => setEditState(s => ({ ...s, address: { ...s.address, street: v } }))}
                  onAddressSelect={(p) => setEditState(s => ({ ...s, address: { ...s.address, ...(p.street && { street: p.street }), ...(p.city && { city: p.city }), ...(p.province && { province: p.province }), ...(p.postal_code && { postal_code: p.postal_code }) } }))}
                  placeholder="Av. Corrientes 1234, Buenos Aires" />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={labelStyle}>
                  Ciudad *
                  <input value={editState.address.city} onChange={e => setEditState(s => ({ ...s, address: { ...s.address, city: e.target.value } }))} style={inputStyle} />
                </label>
                <label style={labelStyle}>
                  Código postal *
                  <input value={editState.address.postal_code ?? ""} onChange={e => setEditState(s => ({ ...s, address: { ...s.address, postal_code: e.target.value } }))} style={inputStyle} />
                </label>
              </div>
              <label style={labelStyle}>
                Provincia *
                <select value={editState.address.province} onChange={e => setEditState(s => ({ ...s, address: { ...s.address, province: e.target.value } }))} style={inputStyle}>
                  <option value="">— Seleccionar provincia —</option>
                  {ARGENTINA_PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            </div>

            {editingUser.updated_by && (
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>
                Última modificación por <strong>{editingUser.updated_by}</strong>
                {editingUser.updated_at ? ` el ${fmtDateTime(editingUser.updated_at)}` : ""}
              </p>
            )}

            {saveError && <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--danger-text)" }}>{saveError}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={closeEdit} style={{ background: "var(--bg-muted)", color: "var(--text-strong)", border: "none", borderRadius: 6, padding: "8px 18px", cursor: "pointer", fontWeight: 500 }}>Cancelar</button>
              <button onClick={handleSave} disabled={saving}
                style={{ background: "var(--sidebar-bg)", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", cursor: saving ? "not-allowed" : "pointer", fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowCreate(false)}>
          <div style={{ background: "var(--bg-card)", borderRadius: 12, padding: 28, width: 520, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: "1.05rem", color: "var(--text-heading)" }}>Nuevo usuario</h2>
              <button onClick={() => setShowCreate(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--text-secondary)" }}>✕</button>
            </div>

            <SectionTitle>Datos de acceso</SectionTitle>
            <div style={{ display: "grid", gap: 14, marginBottom: 20 }}>
              <label style={labelStyle}>
                Nombre de usuario *
                <input value={createForm.username} onChange={e => setCreateForm(s => ({ ...s, username: e.target.value }))} placeholder="ej. op_rosario" style={inputStyle} autoComplete="off" />
              </label>
              <label style={labelStyle}>
                Contraseña *
                <input type="password" value={createForm.password} onChange={e => setCreateForm(s => ({ ...s, password: e.target.value }))} placeholder="••••••••" style={inputStyle} />
              </label>
              {createForm.password.length > 0 && (() => {
                const ok6 = createForm.password.length >= 8;
                const okNum = /\d/.test(createForm.password);
                const item = (met: boolean, text: string) => (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.78rem", color: met ? "var(--ok-text)" : "var(--danger-text)" }}>
                    <span style={{ fontWeight: 700 }}>{met ? "✓" : "✗"}</span>
                    {text}
                  </div>
                );
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6, padding: "8px 10px", background: "var(--bg-subtle)", borderRadius: 6, border: "1px solid var(--border)" }}>
                    {item(ok6, "Al menos 8 caracteres")}
                    {item(okNum, "Al menos un número")}
                  </div>
                );
              })()}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={labelStyle}>
                  Rol *
                  <select value={createForm.role}
                    onChange={e => {
                      const newRole = e.target.value as Role;
                      setCreateForm(s => ({ ...s, role: newRole, branch_id: ROLES_WITH_BRANCH.includes(newRole) ? s.branch_id : "", driver_type: newRole === "driver" ? s.driver_type : "" }));
                    }}
                    style={inputStyle}>
                    {ROLES.map(r => <option key={r} value={r}>{roleLabel[r]}</option>)}
                  </select>
                </label>
                {ROLES_WITH_BRANCH.includes(createForm.role) && (
                  <label style={labelStyle}>
                    Sucursal *
                    <select value={createForm.branch_id} onChange={e => setCreateForm(s => ({ ...s, branch_id: e.target.value }))} style={inputStyle}>
                      <option value="">— Seleccionar —</option>
                      {sortedBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </label>
                )}
              </div>
              {createForm.role === "driver" && (
                <label style={labelStyle}>
                  Tipo de chofer *
                  <select value={createForm.driver_type} onChange={e => setCreateForm(s => ({ ...s, driver_type: e.target.value as DriverType | "" }))} style={inputStyle}>
                    <option value="">— Seleccionar tipo —</option>
                    <option value="ultima_milla">Última milla</option>
                    <option value="intersucursal">Intersucursal</option>
                  </select>
                </label>
              )}
            </div>

            <SectionTitle>Datos personales</SectionTitle>
            <div style={{ display: "grid", gap: 14, marginBottom: 20 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={labelStyle}>
                  Nombre *
                  <input value={createForm.first_name} onChange={e => setCreateForm(s => ({ ...s, first_name: e.target.value }))} style={inputStyle} />
                </label>
                <label style={labelStyle}>
                  Apellido *
                  <input value={createForm.last_name} onChange={e => setCreateForm(s => ({ ...s, last_name: e.target.value }))} style={inputStyle} />
                </label>
              </div>
              <label style={labelStyle}>
                Email *
                <input type="email" value={createForm.email} onChange={e => setCreateForm(s => ({ ...s, email: e.target.value }))} placeholder="usuario@ejemplo.com" style={inputStyle} />
              </label>
            </div>

            <SectionTitle>Domicilio</SectionTitle>
            <div style={{ display: "grid", gap: 14, marginBottom: 20 }}>
              <label style={labelStyle}>
                Calle y número *
                <AddressAutocomplete style={inputStyle} value={createForm.address.street ?? ""}
                  onChange={(v) => setCreateForm(s => ({ ...s, address: { ...s.address, street: v } }))}
                  onAddressSelect={(p) => setCreateForm(s => ({ ...s, address: { ...s.address, ...(p.street && { street: p.street }), ...(p.city && { city: p.city }), ...(p.province && { province: p.province }), ...(p.postal_code && { postal_code: p.postal_code }) } }))}
                  placeholder="Av. Corrientes 1234, Buenos Aires" />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={labelStyle}>
                  Ciudad *
                  <input value={createForm.address.city} onChange={e => setCreateForm(s => ({ ...s, address: { ...s.address, city: e.target.value } }))} style={inputStyle} />
                </label>
                <label style={labelStyle}>
                  Código postal *
                  <input value={createForm.address.postal_code ?? ""} onChange={e => setCreateForm(s => ({ ...s, address: { ...s.address, postal_code: e.target.value } }))} style={inputStyle} />
                </label>
              </div>
              <label style={labelStyle}>
                Provincia *
                <select value={createForm.address.province} onChange={e => setCreateForm(s => ({ ...s, address: { ...s.address, province: e.target.value } }))} style={inputStyle}>
                  <option value="">— Seleccionar provincia —</option>
                  {ARGENTINA_PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            </div>

            {createError && <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--danger-text)" }}>{createError}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowCreate(false)} style={{ background: "var(--bg-muted)", color: "var(--text-strong)", border: "none", borderRadius: 6, padding: "8px 18px", cursor: "pointer", fontWeight: 500 }}>Cancelar</button>
              <button onClick={handleCreate} disabled={creating}
                style={{ background: "var(--sidebar-bg)", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", cursor: creating ? "not-allowed" : "pointer", fontWeight: 600, opacity: creating ? 0.7 : 1 }}>
                {creating ? "Creando…" : "Crear usuario"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: UserStatus }) {
  const isActive = status === "activo";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 10px", borderRadius: 9999, fontSize: 12, fontWeight: 600,
      background: isActive ? "#d1fae518" : "#fee2e218",
      color: isActive ? "var(--ok-text)" : "var(--danger-text)",
      border: `1px solid ${isActive ? "var(--ok-border)" : "var(--danger-border)"}`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: isActive ? "var(--ok)" : "var(--danger-c)", display: "inline-block" }} />
      {isActive ? "Activo" : "Inactivo"}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10, borderBottom: "1px solid var(--bg-muted)", paddingBottom: 6 }}>
      {children}
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 5, fontSize: 13, fontWeight: 600, color: "var(--text-strong)" };
const inputStyle: React.CSSProperties = { padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border-strong)", fontSize: 14, background: "var(--bg-card)" };
