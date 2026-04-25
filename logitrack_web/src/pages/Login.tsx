import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(username, password);
      navigate("/");
    } catch {
      setError("Usuario o contraseña incorrectos.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", background: "#f1f5f9",
    }}>
      <div style={{ maxWidth: 360, width: "90%", background: "#fff", borderRadius: 12, padding: 36, boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#1e3a5f", letterSpacing: 1 }}>LogiTrack</div>
          <div style={{ color: "#6b7280", fontSize: 14, marginTop: 4 }}>Ingresá para continuar</div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 4 }}>
            <label style={labelStyle}>Usuario</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required autoFocus
              style={inputStyle}
              placeholder="ej. operador"
            />
          </div>
          <div style={{ display: "grid", gap: 4 }}>
            <label style={labelStyle}>Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={inputStyle}
              placeholder="••••••••••"
            />
          </div>

          {error && <p style={{ color: "#ef4444", fontSize: 13, margin: 0 }}>{error}</p>}

          <button type="submit" disabled={loading}
            style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 8, padding: "11px", cursor: "pointer", fontWeight: 700, fontSize: 15, marginTop: 4 }}>
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>

        <div style={{ marginTop: 24, padding: 14, background: "#f8fafc", borderRadius: 8, fontSize: 12, color: "#6b7280" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Cuentas de prueba</div>
          {[
            { u: "op_caba",      p: "op_caba123",      r: "Operador · CABA" },
            { u: "sup_caba",     p: "sup_caba123",      r: "Supervisor · CABA" },
            { u: "op_cordoba",   p: "op_cordoba123",    r: "Operador · Córdoba" },
            { u: "sup_cordoba",  p: "sup_cordoba123",   r: "Supervisor · Córdoba" },
            { u: "op_mendoza",   p: "op_mendoza123",    r: "Operador · Mendoza" },
            { u: "sup_mendoza",  p: "sup_mendoza123",   r: "Supervisor · Mendoza" },
            { u: "gerente",      p: "gerente123",       r: "Gerente" },
            { u: "admin",        p: "admin123",         r: "Administrador" },
            { u: "chofer_caba",    p: "chofer_caba123",    r: "Chofer · CABA" },
            { u: "chofer_cordoba", p: "chofer_cordoba123", r: "Chofer · Córdoba" },
            { u: "chofer_mendoza", p: "chofer_mendoza123", r: "Chofer · Mendoza" },
          ].map(({ u, p, r }) => (
            <div key={u} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", cursor: "pointer" }}
              onClick={() => { setUsername(u); setPassword(p); }}>
              <span style={{ color: "#374151" }}><strong>{u}</strong> / {p}</span>
              <span style={{ color: "#9ca3af" }}>{r}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "#374151" };
const inputStyle: React.CSSProperties = { padding: "9px 12px", borderRadius: 7, border: "1px solid #d1d5db", fontSize: 14 };
