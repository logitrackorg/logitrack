import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  Truck,
  Building2,
  Activity,
  Route as RouteIcon,
  Send,
  Upload,
  Settings,
  Sliders,
  Brain,
  DollarSign,
  Map,
  Users,
  Briefcase,
  FileBarChart,
  FileText,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  Menu,
  LogOut,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useIsMobile } from "../hooks/useIsMobile";
import {
  SIDEBAR_RAIL_WIDTH as RAIL_WIDTH,
  SIDEBAR_EXPANDED_WIDTH as EXPANDED_WIDTH,
  SIDEBAR_HOVER_DELAY_MS as HOVER_DELAY_MS,
  SIDEBAR_PINNED_STORAGE_KEY,
  SIDEBAR_PINNED_EVENT,
  readPinnedFlag,
} from "./sidebarLayout";

type Role = "operator" | "supervisor" | "manager" | "admin" | "driver";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  roles: Role[];
  end?: boolean;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const SECTIONS: NavSection[] = [
  {
    title: "Operación",
    items: [
      { to: "/", label: "Envíos", icon: Package, roles: ["operator", "supervisor", "manager"], end: true },
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["supervisor", "manager"] },
      { to: "/auto-reports", label: "Reportes auto.", icon: FileBarChart, roles: ["manager"] },
      { to: "/repartos", label: "Repartos", icon: Send, roles: ["operator", "supervisor"] },
      { to: "/inter-sucursal", label: "Inter-sucursal", icon: RouteIcon, roles: ["operator", "supervisor"] },
      { to: "/viajes", label: "Viajes", icon: Truck, roles: ["operator", "supervisor", "manager"] },
      { to: "/claims", label: "Reclamos", icon: ClipboardList, roles: ["operator", "supervisor", "manager"] },
    ],
  },
  {
    title: "Recursos",
    items: [
      { to: "/vehicles", label: "Flota", icon: Truck, roles: ["operator", "supervisor", "manager", "admin"] },
      { to: "/branches", label: "Sucursales", icon: Building2, roles: ["supervisor", "manager", "admin"] },
      { to: "/supervisor/fatigue", label: "Fatiga", icon: Activity, roles: ["supervisor", "manager"] },
      { to: "/bulk-upload", label: "Importar CSV", icon: Upload, roles: ["operator", "supervisor"] },
    ],
  },
  {
    title: "Administración",
    items: [
      { to: "/admin/users", label: "Usuarios", icon: Users, roles: ["admin"] },
      { to: "/organization", label: "Organización", icon: Briefcase, roles: ["admin"] },
      { to: "/zones", label: "Zonas", icon: Map, roles: ["admin"] },
      { to: "/admin/access-logs", label: "Log de accesos", icon: FileText, roles: ["admin"] },
    ],
  },
  {
    title: "Configuración",
    items: [
      { to: "/routing-config", label: "Ruteo", icon: Sliders, roles: ["admin"] },
      { to: "/ml-config", label: "ML", icon: Brain, roles: ["admin"] },
      { to: "/fatigue-config", label: "Fatiga", icon: Activity, roles: ["admin"] },
      { to: "/pricing-config", label: "Tarifario", icon: DollarSign, roles: ["admin"] },
      { to: "/system-config", label: "Sistema", icon: Settings, roles: ["admin"] },
    ],
  },
];

const ROLE_LABELS: Record<string, string> = {
  operator: "Operador",
  supervisor: "Supervisor",
  manager: "Gerente",
  admin: "Administrador",
  driver: "Chofer",
};

export function Sidebar() {
  const { user, logout, hasRole } = useAuth();
  const isMobile = useIsMobile();

  // Pinned (persisted) — true = always expanded, false = rail mode
  const [pinned, setPinned] = useState<boolean>(readPinnedFlag);
  // Hovered — expand on hover only when not pinned
  const [hovered, setHovered] = useState(false);
  // Mobile drawer
  const [mobileOpen, setMobileOpen] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Broadcast pinned change so layout can update offset
  useEffect(() => {
    localStorage.setItem(SIDEBAR_PINNED_STORAGE_KEY, pinned ? "1" : "0");
    window.dispatchEvent(new CustomEvent(SIDEBAR_PINNED_EVENT, { detail: { pinned } }));
  }, [pinned]);

  // Close mobile drawer on route change (listen via popstate + custom hook would be ideal,
  // but for SPA navigation we close on link click below).
  useEffect(() => {
    if (mobileOpen) {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") setMobileOpen(false);
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }
  }, [mobileOpen]);

  const expanded = isMobile ? mobileOpen : pinned || hovered;
  const width = isMobile ? EXPANDED_WIDTH : expanded ? EXPANDED_WIDTH : RAIL_WIDTH;

  const visibleSections = useMemo(() => {
    if (!user) return [];
    return SECTIONS.map((s) => ({
      ...s,
      items: s.items.filter((it) => hasRole(...it.roles)),
    })).filter((s) => s.items.length > 0);
  }, [user, hasRole]);

  if (!user) return null;

  const onMouseEnter = () => {
    if (isMobile || pinned) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovered(true), HOVER_DELAY_MS);
  };
  const onMouseLeave = () => {
    if (isMobile || pinned) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHovered(false);
  };

  const closeMobile = () => setMobileOpen(false);

  return (
    <>
      {/* Mobile hamburger trigger — fixed top-left */}
      {isMobile && !mobileOpen && (
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir menú"
          style={{
            position: "fixed", top: 10, left: 10, zIndex: 90,
            width: 40, height: 40, borderRadius: 8,
            background: "#1e3a5f", color: "#fff", border: "none",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          }}
        >
          <Menu size={20} />
        </button>
      )}

      {/* Mobile overlay backdrop */}
      {isMobile && mobileOpen && (
        <div
          onClick={closeMobile}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            zIndex: 95,
          }}
        />
      )}

      {/* Sidebar */}
      <aside
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        aria-expanded={expanded}
        style={{
          position: "fixed",
          top: 0, left: 0, bottom: 0,
          width,
          background: "var(--sidebar-bg)",
          color: "#cbd5e1",
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid var(--sidebar-border)",
          transition: "width 0.18s ease, transform 0.22s ease",
          zIndex: 100,
          transform: isMobile && !mobileOpen ? "translateX(-100%)" : "translateX(0)",
          overflow: "hidden",
        }}
      >
        {/* Header / Brand */}
        <div style={{
          height: 56,
          display: "flex", alignItems: "center",
          padding: expanded ? "0 16px" : "0",
          justifyContent: expanded ? "space-between" : "center",
          borderBottom: "1px solid var(--sidebar-border)",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, overflow: "hidden" }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontWeight: 800, fontSize: 14, flexShrink: 0,
            }}>
              LT
            </div>
            {expanded && (
              <span style={{
                fontWeight: 800, fontSize: 15, letterSpacing: 0.5,
                color: "#e2e8f0", whiteSpace: "nowrap",
              }}>
                LogiTrack
              </span>
            )}
          </div>
          {isMobile && expanded && (
            <button
              onClick={closeMobile}
              aria-label="Cerrar menú"
              style={{
                background: "none", border: "none", color: "#94a3b8",
                cursor: "pointer", padding: 4, display: "flex",
              }}
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Nav sections (scrollable) */}
        <nav style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "12px 0",
        }}>
          {visibleSections.map((section, idx) => (
            <div key={section.title} style={{ marginBottom: idx === visibleSections.length - 1 ? 0 : 4 }}>
              {/* Títulos de sección solo cuando está fijado o en mobile — en hover no, para no mover los ítems */}
              {(pinned || isMobile) && expanded ? (
                <div style={{
                  padding: "6px 20px",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  color: "#64748b",
                  whiteSpace: "nowrap",
                }}>
                  {section.title}
                </div>
              ) : idx > 0 ? (
                <div style={{ height: 1, background: "var(--sidebar-border)", margin: "6px 14px" }} />
              ) : null}
              {section.items.map((item) => (
                <SidebarLink
                  key={item.to}
                  item={item}
                  expanded={expanded}
                  onNavigate={isMobile ? closeMobile : undefined}
                />
              ))}
            </div>
          ))}
        </nav>

        {/* Footer: pin toggle + user + logout */}
        <div style={{
          borderTop: "1px solid var(--sidebar-border)",
          padding: expanded ? "10px 12px" : "10px 0",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}>
          {/* Pin toggle (desktop only) */}
          {!isMobile && (
            <button
              onClick={() => setPinned((v) => !v)}
              title={pinned ? "Contraer menú" : "Fijar menú expandido"}
              style={{
                background: "none",
                border: "none",
                color: "#64748b",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: expanded ? "flex-start" : "center",
                gap: 10,
                padding: "8px 10px",
                borderRadius: 8,
                fontSize: 12,
                transition: "background 0.15s, color 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#1e3a5f";
                e.currentTarget.style.color = "#cbd5e1";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "#64748b";
              }}
            >
              {pinned ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
              {expanded && <span>{pinned ? "Contraer" : "Fijar expandido"}</span>}
            </button>
          )}

          {/* User chip */}
          <NavLink
            to="/profile"
            onClick={isMobile ? closeMobile : undefined}
            style={{
              textDecoration: "none",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              borderRadius: 8,
              background: "#152e52",
              color: "#cbd5e1",
              justifyContent: expanded ? "flex-start" : "center",
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#1e3a5f")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#152e52")}
          >
            <div style={{
              width: 30, height: 30, borderRadius: "50%",
              background: "linear-gradient(135deg, #60a5fa, #2563eb)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontWeight: 700, fontSize: 12, flexShrink: 0,
            }}>
              {user.username.slice(0, 2).toUpperCase()}
            </div>
            {expanded && (
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  fontSize: 13, fontWeight: 600, color: "#e2e8f0",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {user.username}
                </div>
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  {ROLE_LABELS[user.role] ?? user.role}
                </div>
              </div>
            )}
          </NavLink>

          {/* Logout */}
          <button
            onClick={logout}
            title="Cerrar sesión"
            style={{
              background: "none",
              border: "1px solid #1e3a5f",
              color: "#94a3b8",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              borderRadius: 8,
              justifyContent: expanded ? "flex-start" : "center",
              fontSize: 13,
              transition: "background 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#1e3a5f";
              e.currentTarget.style.color = "#fca5a5";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "#94a3b8";
            }}
          >
            <LogOut size={16} />
            {expanded && <span>Cerrar sesión</span>}
          </button>
        </div>
      </aside>
    </>
  );
}

function SidebarLink({
  item,
  expanded,
  onNavigate,
}: {
  item: NavItem;
  expanded: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const [hover, setHover] = useState(false);
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      title={expanded ? undefined : item.label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={({ isActive }) => {
        const bg = isActive ? "#1e3a5f" : hover ? "#152e52" : "transparent";
        const color = isActive || hover ? "#e2e8f0" : "#94a3b8";
        return {
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: expanded ? "9px 20px" : "9px 0",
          margin: "1px 8px",
          justifyContent: expanded ? "flex-start" : "center",
          textDecoration: "none",
          color,
          background: bg,
          borderRadius: 8,
          fontSize: 13,
          fontWeight: isActive ? 600 : 500,
          position: "relative",
          whiteSpace: "nowrap",
          transition: "background 0.12s, color 0.12s",
          boxShadow: isActive ? "inset 3px 0 0 #60a5fa" : "none",
        };
      }}
    >
      <Icon size={18} strokeWidth={2} />
      {expanded && <span>{item.label}</span>}
    </NavLink>
  );
}
