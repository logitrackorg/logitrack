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
  TrendingUp,
  Gauge,
  Globe,
  ChevronLeft,
  ChevronRight,
  Menu,
  LogOut,
  X,
  Calendar,
  CreditCard,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useOrganizationTheme } from "../context/OrganizationThemeContext";
import { useIsMobile } from "../hooks/useIsMobile";
import {
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
      { to: "/repartos", label: "Repartos", icon: Send, roles: ["operator", "supervisor"] },
      { to: "/inter-sucursal", label: "Inter-sucursal", icon: RouteIcon, roles: ["operator", "supervisor"] },
      { to: "/viajes", label: "Viajes", icon: Truck, roles: ["operator", "supervisor", "manager"] },
      { to: "/calendar", label: "Calendario", icon: Calendar, roles: ["operator", "supervisor", "manager"] },
      { to: "/bulk-upload", label: "Importar CSV", icon: Upload, roles: ["operator", "supervisor"] },
    ],
  },
  {
    title: "Monitoreo",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["supervisor", "manager"] },
      { to: "/auto-reports", label: "Reportes auto.", icon: FileBarChart, roles: ["manager"] },
      { to: "/claims", label: "Reclamos", icon: ClipboardList, roles: ["operator", "supervisor", "manager"] },
      { to: "/sla-audit", label: "Escalado SLA", icon: TrendingUp, roles: ["supervisor", "manager"] },
    ],
  },
  {
    title: "Recursos",
    items: [
      { to: "/vehicles", label: "Flota", icon: Truck, roles: ["operator", "supervisor", "manager", "admin"] },
      { to: "/branches", label: "Sucursales", icon: Building2, roles: ["supervisor", "manager", "admin"] },
      { to: "/supervisor/fatigue", label: "Fatiga", icon: Activity, roles: ["supervisor", "manager"] },
    ],
  },
  {
    title: "Administración",
    items: [
      { to: "/red", label: "Red", icon: Globe, roles: ["manager", "admin"] },
      { to: "/admin/users", label: "Usuarios", icon: Users, roles: ["admin"] },
      { to: "/organization", label: "Organización", icon: Briefcase, roles: ["admin"] },
      { to: "/zones", label: "Zonas", icon: Map, roles: ["admin"] },
      { to: "/admin/access-logs", label: "Log de accesos", icon: FileText, roles: ["admin"] },
    ],
  },
  {
    title: "Configuración",
    items: [
      { to: "/admin/sla-config", label: "Motor SLA", icon: Gauge, roles: ["admin"] },
      { to: "/routing-config", label: "Ruteo", icon: Sliders, roles: ["admin"] },
      { to: "/ml-config", label: "ML", icon: Brain, roles: ["admin"] },
      { to: "/fatigue-config", label: "Fatiga", icon: Activity, roles: ["admin"] },
      { to: "/pricing-config", label: "Tarifario", icon: DollarSign, roles: ["admin"] },
      { to: "/payment-config", label: "Pagos", icon: CreditCard, roles: ["admin"] },
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
  const { config } = useOrganizationTheme();
  const logoUrl = config?.logo_url?.trim();
  const orgName = config?.name?.trim() || "LogiTrack";
  const isMobile = useIsMobile();

  // Detect sidebar background luminance to pick light/dark text
  const [sidebarDark, setSidebarDark] = useState(true);
  useEffect(() => {
    const el = document.documentElement;
    const bg = getComputedStyle(el).getPropertyValue("--sidebar-bg").trim();
    if (!bg) return;
    const hex = bg.startsWith("#") ? bg : null;
    if (hex && hex.length >= 7) {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      const lr = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
      const lg = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
      const lb = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
      const lum = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
      setSidebarDark(lum < 0.5);
    }
  }, [config?.sidebar_color]);

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
          className="fixed top-2.5 left-2.5 z-[90] w-10 h-10 rounded-lg bg-[var(--sidebar-bg)] text-white flex items-center justify-center cursor-pointer shadow-md border-0"
        >
          <Menu size={20} />
        </button>
      )}

      {/* Mobile overlay backdrop */}
      {isMobile && mobileOpen && (
        <div
          onClick={closeMobile}
          className="fixed inset-0 bg-black/50 z-[95]"
        />
      )}

      {/* Sidebar */}
      <aside
        data-sidebar-dark={sidebarDark}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        aria-expanded={expanded}
        className={`fixed top-0 left-0 bottom-0 flex flex-col bg-[var(--sidebar-bg)] text-slate-300 border-r border-sidebar-border transition-[width,transform] duration-200 ease-in-out z-[100] overflow-hidden ${
          isMobile && !mobileOpen ? "-translate-x-full" : "translate-x-0"
        } ${expanded ? "w-60" : "w-[68px]"}`}
      >
        {/* Header / Brand */}
        <div
          className={`h-14 flex items-center shrink-0 border-b border-sidebar-border ${
            expanded ? "px-4 justify-between" : "px-0 justify-center"
          }`}
        >
          <div className="flex items-center gap-2.5 overflow-hidden">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={orgName}
                className="w-8 h-8 rounded-lg object-contain shrink-0 bg-white/10"
              />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-extrabold text-sm shrink-0">
                {orgName.slice(0, 2).toUpperCase()}
              </div>
            )}
            {expanded && (
              <span className="font-extrabold text-[15px] tracking-[0.5px] text-white/90 truncate" title={orgName}>
                {orgName}
              </span>
            )}
          </div>
          {isMobile && expanded && (
            <button
              onClick={closeMobile}
              aria-label="Cerrar menú"
              className="bg-transparent border-0 text-slate-400 cursor-pointer p-1 flex"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Nav sections (scrollable) */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3">
          {visibleSections.map((section, idx) => (
            <div
              key={section.title}
              className={idx === visibleSections.length - 1 ? "" : "mb-1"}
            >
              {/* Section titles visible whenever expanded.
                   When collapsed, a thin line occupies the same
                   fixed height so items never shift position.
                   overflow-hidden + min-h-0 prevent flex from
                   stretching the container during the width transition. */}
              {expanded ? (
                <div className="h-[27px] min-h-0 overflow-hidden flex items-center px-5 text-[10px] font-bold tracking-[1px] uppercase text-white/40 whitespace-nowrap">
                  {section.title}
                </div>
              ) : (
                <div className="h-[27px] min-h-0 flex items-center px-3.5" title={section.title}>
                  <div className="h-px bg-sidebar-border flex-1" />
                </div>
              )}
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
        <div
          className={`border-t border-sidebar-border shrink-0 flex flex-col gap-1.5 ${
            expanded ? "py-2.5 px-3" : "py-2.5 px-0"
          }`}
        >
          {/* Pin toggle (desktop only) */}
          {!isMobile && (
            <button
              onClick={() => setPinned((v) => !v)}
              title={pinned ? "Contraer menú" : "Fijar menú expandido"}
              className={`bg-transparent border-0 text-white/50 cursor-pointer flex items-center gap-2.5 py-2 px-2.5 rounded-lg text-xs transition-colors duration-150 hover:bg-white/10 hover:text-white/80 h-[34px] ${
                expanded ? "justify-start w-full" : "justify-center w-fit mx-auto"
              }`}
            >
              {pinned ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
              {expanded && <span className="whitespace-nowrap">{pinned ? "Contraer" : "Fijar expandido"}</span>}
            </button>
          )}

          {/* User chip */}
          <NavLink
            to="/profile"
            onClick={isMobile ? closeMobile : undefined}
            className={
              `no-underline flex items-center gap-2.5 py-2 px-2.5 rounded-lg bg-white/10 text-white/80 transition-colors duration-150 hover:bg-white/15 h-[52px] ${
                expanded ? "justify-start w-full" : "justify-center w-fit mx-auto"
              }`
            }
          >
            <div className="w-[30px] h-[30px] rounded-full bg-gradient-to-br from-[var(--brand-400,#60a5fa)] to-[var(--brand-600,var(--brand))] flex items-center justify-center text-white font-bold text-xs shrink-0">
              {user.username.slice(0, 2).toUpperCase()}
            </div>
            {expanded && (
              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="text-[13px] font-semibold text-white/90 truncate">
                  {user.username}
                </div>
                <div className="text-[11px] text-white/50 whitespace-nowrap">
                  {ROLE_LABELS[user.role] ?? user.role}
                </div>
              </div>
            )}
          </NavLink>

          {/* Logout */}
          <button
            onClick={logout}
            title="Cerrar sesión"
            className={`bg-transparent border border-white/10 text-white/40 cursor-pointer flex items-center gap-2.5 py-2 px-2.5 rounded-lg text-[13px] transition-colors duration-150 hover:bg-white/5 hover:text-red-300 h-[38px] ${
                expanded ? "justify-start w-full" : "justify-center w-fit mx-auto"
              }`}
          >
            <LogOut size={16} />
            {expanded && <span className="whitespace-nowrap">Cerrar sesión</span>}
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
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      title={expanded ? undefined : item.label}
      className={({ isActive }) => {
        const base =
          "flex items-center gap-3 my-px mx-2 rounded-lg text-[13px] relative transition-colors duration-[120ms] h-10";
        const pad = expanded
          ? "py-2.5 px-5 justify-start"
          : "py-2.5 px-0 justify-center";
        if (isActive) {
          return `${base} ${pad} no-underline text-white font-semibold bg-white/5 border-l-[3px] border-[var(--brand-400)]`;
        }
        return `${base} ${pad} no-underline text-white/60 font-medium hover:bg-[var(--sidebar-hover)] hover:text-white`;
      }}
    >
      <Icon size={18} strokeWidth={2} />
      {expanded && <span className="whitespace-nowrap">{item.label}</span>}
    </NavLink>
  );
}
