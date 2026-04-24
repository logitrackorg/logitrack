import { useEffect, useState } from "react";
import { adminApi, type UserUpdatePayload, type UserCreatePayload } from "../api/admin";
import { branchApi, type Branch } from "../api/branches";
import type { User, Role } from "../api/auth";

const ROLES: Role[] = ["operator", "supervisor", "driver", "manager", "admin"];
const ROLES_WITH_BRANCH: Role[] = ["operator", "supervisor", "driver"];

const roleLabel: Record<Role, string> = {
  operator: "Operator",
  supervisor: "Supervisor",
  driver: "Driver",
  manager: "Manager",
  admin: "Admin",
};

const roleBadgeColor: Record<Role, string> = {
  operator: "#3b82f6",
  supervisor: "#8b5cf6",
  driver: "#f59e0b",
  manager: "#10b981",
  admin: "#ef4444",
};

interface EditState { username: string; role: Role; branch_id: string; }

export function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editState, setEditState] = useState<EditState>({ username: "", role: "operator", branch_id: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<UserCreatePayload>({ username: "", password: "", role: "operator", branch_id: "" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "">("");

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
    setEditState({ username: u.username, role: u.role, branch_id: u.branch_id ?? "" });
    setSaveError("");
  };
  const closeEdit = () => { setEditingUser(null); setSaveError(""); };

  const handleSave = async () => {
    if (!editingUser) return;
    if (ROLES_WITH_BRANCH.includes(editState.role) && !editState.branch_id) {
      setSaveError("Branch is required for this role.");
      return;
    }
    setSaving(true); setSaveError("");
    try {
      const payload: UserUpdatePayload = {};
      if (editState.username !== editingUser.username) payload.username = editState.username;
      if (editState.role !== editingUser.role) payload.role = editState.role;
      if (editState.branch_id !== (editingUser.branch_id ?? "")) payload.branch_id = editState.branch_id;
      if (Object.keys(payload).length === 0) { closeEdit(); return; }
      const updated = await adminApi.updateUser(editingUser.id, payload);
      setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
      closeEdit();
    } catch (e: unknown) {
      setSaveError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to save.");
    } finally { setSaving(false); }
  };

  const handleCreate = async () => {
    if (ROLES_WITH_BRANCH.includes(createForm.role!) && !createForm.branch_id) {
      setCreateError("Branch is required for this role.");
      return;
    }
    setCreating(true); setCreateError("");
    try {
      const payload: UserCreatePayload = { ...createForm };
      if (!ROLES_WITH_BRANCH.includes(payload.role)) delete payload.branch_id;
      const newUser = await adminApi.createUser(payload);
      setUsers(prev => [...prev, newUser]);
      setShowCreate(false);
      setCreateForm({ username: "", password: "", role: "operator", branch_id: "" });
    } catch (e: unknown) {
      setCreateError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to create user.");
    } finally { setCreating(false); }
  };

  const branchName = (id: string) => branches.find(b => b.id === id)?.name ?? id;

  const filtered = users.filter(u => {
    if (roleFilter && u.role !== roleFilter) return false;
    if (search && !u.username.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const sortedBranches = [...branches].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: "1.4rem", color: "#1e3a5f" }}>User Management</h1>
        <button onClick={() => { setShowCreate(true); setCreateError(""); setCreateForm({ username: "", password: "", role: "operator", branch_id: "" }); }}
          style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
          + New User
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by username..."
          style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, width: 220 }} />
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value as Role | "")}
          style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, background: "#fff" }}>
          <option value="">All roles</option>
          {ROLES.map(r => <option key={r} value={r}>{roleLabel[r]}</option>)}
        </select>
        {(search || roleFilter) && (
          <button onClick={() => { setSearch(""); setRoleFilter(""); }}
            style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 14, textDecoration: "underline" }}>
            Clear
          </button>
        )}
        <span style={{ marginLeft: "auto", fontSize: 13, color: "#6b7280" }}>{filtered.length} user{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {loading ? <p style={{ color: "#6b7280" }}>Loading...</p> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 600 }}>
            <thead>
              <tr style={{ background: "#f9fafb", textAlign: "left" }}>
                {["ID", "Username", "Role", "Branch", ""].map(h => (
                  <th key={h} style={{ padding: "10px 14px", borderBottom: "2px solid #e5e7eb", fontWeight: 600, color: "#374151", fontSize: 13 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} style={{ borderBottom: "1px solid #e5e7eb" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#f9fafb")}
                  onMouseLeave={e => (e.currentTarget.style.background = "")}>
                  <td style={{ padding: "10px 14px", color: "#9ca3af", fontSize: 12 }}>{u.id}</td>
                  <td style={{ padding: "10px 14px", fontWeight: 600, color: "#111827" }}>{u.username}</td>
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
                  <td style={{ padding: "10px 14px", textAlign: "right" }}>
                    <button onClick={() => openEdit(u)}
                      style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 13, color: "#374151", fontWeight: 500 }}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit modal */}
      {editingUser && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={closeEdit}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 28, width: 440, maxWidth: "95vw" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: "1.05rem", color: "#1e3a5f" }}>Edit User</h2>
              <button onClick={closeEdit} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>✕</button>
            </div>
            <div style={{ display: "grid", gap: 14 }}>
              <label style={labelStyle}>
                Username
                <input value={editState.username} onChange={e => setEditState(s => ({ ...s, username: e.target.value }))} style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Role
                <select value={editState.role}
                  onChange={e => setEditState(s => ({ ...s, role: e.target.value as Role, branch_id: ROLES_WITH_BRANCH.includes(e.target.value as Role) ? s.branch_id : "" }))}
                  style={inputStyle}>
                  {ROLES.map(r => <option key={r} value={r}>{roleLabel[r]}</option>)}
                </select>
              </label>
              {ROLES_WITH_BRANCH.includes(editState.role) && (
                <label style={labelStyle}>
                  Assigned Branch *
                  <select value={editState.branch_id} onChange={e => setEditState(s => ({ ...s, branch_id: e.target.value }))} style={inputStyle}>
                    <option value="">— Select branch —</option>
                    {sortedBranches.map(b => <option key={b.id} value={b.id}>{b.name} — {b.address.city}</option>)}
                  </select>
                </label>
              )}
            </div>
            {saveError && <p style={{ margin: "12px 0 0", fontSize: 13, color: "#dc2626" }}>{saveError}</p>}
            <div style={{ marginTop: 20, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={closeEdit} style={{ background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 6, padding: "8px 18px", cursor: "pointer", fontWeight: 500 }}>Cancel</button>
              <button onClick={handleSave} disabled={saving}
                style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", cursor: saving ? "not-allowed" : "pointer", fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowCreate(false)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 28, width: 440, maxWidth: "95vw" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: "1.05rem", color: "#1e3a5f" }}>New User</h2>
              <button onClick={() => setShowCreate(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>✕</button>
            </div>
            <div style={{ display: "grid", gap: 14 }}>
              <label style={labelStyle}>
                Username *
                <input value={createForm.username} onChange={e => setCreateForm(s => ({ ...s, username: e.target.value }))} placeholder="e.g. op_rosario" style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Password *
                <input type="password" value={createForm.password} onChange={e => setCreateForm(s => ({ ...s, password: e.target.value }))} placeholder="••••••••" style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Role *
                <select value={createForm.role}
                  onChange={e => setCreateForm(s => ({ ...s, role: e.target.value as Role, branch_id: ROLES_WITH_BRANCH.includes(e.target.value as Role) ? s.branch_id : "" }))}
                  style={inputStyle}>
                  {ROLES.map(r => <option key={r} value={r}>{roleLabel[r]}</option>)}
                </select>
              </label>
              {ROLES_WITH_BRANCH.includes(createForm.role!) && (
                <label style={labelStyle}>
                  Assigned Branch *
                  <select value={createForm.branch_id ?? ""} onChange={e => setCreateForm(s => ({ ...s, branch_id: e.target.value }))} style={inputStyle}>
                    <option value="">— Select branch —</option>
                    {sortedBranches.map(b => <option key={b.id} value={b.id}>{b.name} — {b.address.city}</option>)}
                  </select>
                </label>
              )}
            </div>
            {createError && <p style={{ margin: "12px 0 0", fontSize: 13, color: "#dc2626" }}>{createError}</p>}
            <div style={{ marginTop: 20, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowCreate(false)} style={{ background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 6, padding: "8px 18px", cursor: "pointer", fontWeight: 500 }}>Cancel</button>
              <button onClick={handleCreate} disabled={creating || !createForm.username || !createForm.password}
                style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", cursor: creating ? "not-allowed" : "pointer", fontWeight: 600, opacity: creating || !createForm.username || !createForm.password ? 0.6 : 1 }}>
                {creating ? "Creating…" : "Create user"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 5, fontSize: 13, fontWeight: 600, color: "#374151" };
const inputStyle: React.CSSProperties = { padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, background: "#fff" };
