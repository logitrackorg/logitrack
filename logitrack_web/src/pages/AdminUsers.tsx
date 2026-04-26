import { useEffect, useState } from "react";
import { adminApi, type UserUpdatePayload, type UserCreatePayload } from "../api/admin";
import { branchApi, type Branch } from "../api/branches";
import type { User, Role, UserStatus, UserAddress } from "../api/auth";
import { fmtDateTime } from "../utils/date";

const ROLES: Role[] = ["operator", "supervisor", "driver", "manager", "admin"];
const ROLES_WITH_BRANCH: Role[] = ["operator", "supervisor", "driver"];

const roleLabel: Record<Role, string> = {
  operator: "Operador",
  supervisor: "Supervisor",
  driver: "Chofer",
  manager: "Gerente",
  admin: "Admin",
};

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
  address: UserAddress;
}

const emptyAddress = (): UserAddress => ({ street: "", city: "", province: "", postal_code: "" });

const emptyCreate = (): CreateState => ({
  username: "", password: "", first_name: "", last_name: "", email: "",
  role: "operator", branch_id: "", address: emptyAddress(),
});

const reEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const reName = /^[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ\s'\-]+$/;
const reUsername = /^[a-zA-Z0-9_\-]+$/;
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
  const [users, setUsers] = useState<User[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<User | null>(null);
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
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: "1.4rem", color: "#1e3a5f" }}>Gestión de usuarios</h1>
        <button onClick={() => { setShowCreate(true); setCreateError(""); setCreateForm(emptyCreate()); }}
          style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
          + Nuevo usuario
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por usuario, nombre o email..."
          style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, width: 260 }} />
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value as Role | "")}
          style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, background: "#fff" }}>
          <option value="">Todos los roles</option>
          {ROLES.map(r => <option key={r} value={r}>{roleLabel[r]}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as UserStatus | "")}
          style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, background: "#fff" }}>
          <option value="">Todos los estados</option>
          <option value="activo">Activo</option>
          <option value="inactivo">Inactivo</option>
        </select>
        {(search || roleFilter || statusFilter) && (
          <button onClick={() => { setSearch(""); setRoleFilter(""); setStatusFilter(""); }}
            style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 14, textDecoration: "underline" }}>
            Limpiar
          </button>
        )}
        <span style={{ marginLeft: "auto", fontSize: 13, color: "#6b7280" }}>{filtered.length} usuario{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {loading ? <p style={{ color: "#6b7280" }}>Cargando...</p> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 700 }}>
            <thead>
              <tr style={{ background: "#f9fafb", textAlign: "left" }}>
                {["ID", "Nombre", "Usuario", "Rol", "Sucursal", "Estado", ""].map(h => (
                  <th key={h} style={{ padding: "10px 14px", borderBottom: "2px solid #e5e7eb", fontWeight: 600, color: "#374151", fontSize: 13 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => {
                const isInactive = (u.status ?? "activo") === "inactivo";
                return (
                  <tr key={u.id} style={{ borderBottom: "1px solid #e5e7eb", opacity: isInactive ? 0.65 : 1 }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#f9fafb")}
                    onMouseLeave={e => (e.currentTarget.style.background = "")}>
                    <td style={{ padding: "10px 14px", color: "#9ca3af", fontSize: 12 }}>{u.id}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ fontWeight: 600, color: "#111827" }}>
                        {u.first_name || u.last_name ? `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() : <span style={{ color: "#9ca3af", fontStyle: "italic" }}>—</span>}
                      </div>
                      {u.email && <div style={{ fontSize: 12, color: "#6b7280" }}>{u.email}</div>}
                    </td>
                    <td style={{ padding: "10px 14px", color: "#374151" }}>{u.username}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 9999, fontSize: 12, fontWeight: 600, background: `${roleBadgeColor[u.role]}18`, color: roleBadgeColor[u.role] }}>
                        {roleLabel[u.role]}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      {u.branch_id
                        ? <span style={{ background: "#f0f9ff", border: "1px solid #bfdbfe", borderRadius: 6, padding: "2px 8px", fontSize: 12, color: "#1e3a5f" }}>{branchName(u.branch_id)}</span>
                        : <span style={{ color: "#9ca3af", fontStyle: "italic" }}>—</span>}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <StatusBadge status={u.status ?? "activo"} />
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right" }}>
                      <button onClick={() => openEdit(u)}
                        style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 13, color: "#374151", fontWeight: 500 }}>
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
          <div style={{ background: "#fff", borderRadius: 12, padding: 28, width: 520, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: "1.05rem", color: "#1e3a5f" }}>Editar usuario</h2>
              <button onClick={closeEdit} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>✕</button>
            </div>

            <div style={{ background: "#f8fafc", borderRadius: 8, padding: "8px 14px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 13, color: "#6b7280" }}>Usuario:</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#1e3a5f", fontFamily: "monospace" }}>{editingUser.username}</span>
              <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: "auto" }}>ID #{editingUser.id}</span>
            </div>

            <SectionTitle>Datos de acceso</SectionTitle>
            <div style={{ display: "grid", gap: 14, marginBottom: 20 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={labelStyle}>
                  Rol *
                  <select value={editState.role}
                    onChange={e => setEditState(s => ({ ...s, role: e.target.value as Role, branch_id: ROLES_WITH_BRANCH.includes(e.target.value as Role) ? s.branch_id : "" }))}
                    style={inputStyle}>
                    {ROLES.map(r => <option key={r} value={r}>{roleLabel[r]}</option>)}
                  </select>
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
                <input value={editState.address.street ?? ""} onChange={e => setEditState(s => ({ ...s, address: { ...s.address, street: e.target.value } }))} placeholder="Av. Corrientes 1234" style={inputStyle} />
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
              <p style={{ fontSize: 12, color: "#9ca3af", margin: "0 0 12px" }}>
                Última modificación por <strong>{editingUser.updated_by}</strong>
                {editingUser.updated_at ? ` el ${fmtDateTime(editingUser.updated_at)}` : ""}
              </p>
            )}

            {saveError && <p style={{ margin: "0 0 12px", fontSize: 13, color: "#dc2626" }}>{saveError}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={closeEdit} style={{ background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 6, padding: "8px 18px", cursor: "pointer", fontWeight: 500 }}>Cancelar</button>
              <button onClick={handleSave} disabled={saving}
                style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", cursor: saving ? "not-allowed" : "pointer", fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowCreate(false)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 28, width: 520, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: "1.05rem", color: "#1e3a5f" }}>Nuevo usuario</h2>
              <button onClick={() => setShowCreate(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>✕</button>
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={labelStyle}>
                  Rol *
                  <select value={createForm.role}
                    onChange={e => setCreateForm(s => ({ ...s, role: e.target.value as Role, branch_id: ROLES_WITH_BRANCH.includes(e.target.value as Role) ? s.branch_id : "" }))}
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
                <input value={createForm.address.street ?? ""} onChange={e => setCreateForm(s => ({ ...s, address: { ...s.address, street: e.target.value } }))} placeholder="Av. Corrientes 1234" style={inputStyle} />
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

            {createError && <p style={{ margin: "0 0 12px", fontSize: 13, color: "#dc2626" }}>{createError}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowCreate(false)} style={{ background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 6, padding: "8px 18px", cursor: "pointer", fontWeight: 500 }}>Cancelar</button>
              <button onClick={handleCreate} disabled={creating}
                style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", cursor: creating ? "not-allowed" : "pointer", fontWeight: 600, opacity: creating ? 0.7 : 1 }}>
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
      color: isActive ? "#065f46" : "#991b1b",
      border: `1px solid ${isActive ? "#6ee7b7" : "#fca5a5"}`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: isActive ? "#10b981" : "#ef4444", display: "inline-block" }} />
      {isActive ? "Activo" : "Inactivo"}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10, borderBottom: "1px solid #f3f4f6", paddingBottom: 6 }}>
      {children}
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 5, fontSize: 13, fontWeight: 600, color: "#374151" };
const inputStyle: React.CSSProperties = { padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, background: "#fff" };
