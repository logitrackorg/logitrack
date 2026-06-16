import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, User } from "lucide-react";
import { usersApi, type UserProfile } from "../api/users";
import { AwardBadge } from "../components/AwardBadge";

const ROLE_LABELS: Record<string, string> = {
  operator: "Operador",
  supervisor: "Supervisor",
  manager: "Gerente",
  admin: "Administrador",
  driver: "Chofer",
};

const DRIVER_TYPE_LABELS: Record<string, string> = {
  ultima_milla: "Última milla",
  intersucursal: "Inter-sucursal",
};

export function EmployeeProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    usersApi
      .getById(id)
      .then(setProfile)
      .catch(() => setError("No se pudo cargar el perfil del empleado."))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted, #64748b)" }}>
        Cargando perfil...
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "#ef4444" }}>
        {error ?? "Perfil no encontrado."}
      </div>
    );
  }

  const hasAwards = (profile.awards?.length ?? 0) > 0;

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px" }}>
      <button
        onClick={() => navigate(-1)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-muted, #64748b)",
          fontSize: 14,
          marginBottom: 20,
          padding: 0,
        }}
      >
        <ArrowLeft size={16} />
        Volver
      </button>

      <div
        style={{
          background: "var(--card-bg, #fff)",
          border: "1px solid var(--border-color, #e2e8f0)",
          borderRadius: 16,
          padding: 28,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: "50%",
              background: "linear-gradient(135deg,#3b82f6,#6366f1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <User size={28} color="#fff" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{profile.full_name}</h1>
            <div style={{ color: "var(--text-muted, #64748b)", fontSize: 14 }}>
              @{profile.username}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px", marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted, #64748b)", marginBottom: 4 }}>
              Rol
            </div>
            <div style={{ fontSize: 15 }}>{ROLE_LABELS[profile.role] ?? profile.role}</div>
          </div>

          {profile.branch_name && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted, #64748b)", marginBottom: 4 }}>
                Sucursal
              </div>
              <div style={{ fontSize: 15 }}>{profile.branch_name}</div>
            </div>
          )}

          {profile.driver_type && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted, #64748b)", marginBottom: 4 }}>
                Tipo de chofer
              </div>
              <div style={{ fontSize: 15 }}>{DRIVER_TYPE_LABELS[profile.driver_type] ?? profile.driver_type}</div>
            </div>
          )}

          {profile.email && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted, #64748b)", marginBottom: 4 }}>
                Email
              </div>
              <div style={{ fontSize: 15 }}>{profile.email}</div>
            </div>
          )}
        </div>

        {/* Distinciones */}
        <div>
          <h2 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>Distinciones</h2>
          {hasAwards ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {profile.awards!.map((a, i) => (
                <AwardBadge key={i} award={a} />
              ))}
            </div>
          ) : (
            <p style={{ color: "var(--text-muted, #94a3b8)", fontSize: 14, margin: 0 }}>
              Este empleado no tiene distinciones registradas.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
