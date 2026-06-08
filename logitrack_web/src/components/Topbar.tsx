import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";
import { useIsMobile } from "../hooks/useIsMobile";
import { useTopbarSlotRef } from "../hooks/useTopbarSlot";
import { cn } from "../lib/utils";

function titleForPath(pathname: string): string {
  const found = ROUTE_TITLES.find((r) => r.match.test(pathname));
  return found?.title ?? "";
}

function subtitleForPath(pathname: string, role: string): string {
  if (pathname === "/" || pathname.startsWith("/shipments")) return role === "manager" ? "Todos los envíos" : "Envíos de tu sucursal";
  if (pathname.startsWith("/dashboard")) return "Métricas y KPIs";
  if (pathname.startsWith("/vehicles")) return "Gestión de flota";
  if (pathname.startsWith("/branches")) return "Sucursales activas";
  if (pathname.startsWith("/admin/users")) return "Gestión de cuentas";
  if (pathname.startsWith("/repartos")) return "Planificación de última milla";
  if (pathname.startsWith("/inter-sucursal")) return "Despachos entre sucursales";
  return "";
}

/** Mapa de rutas → título legible para mostrar a la izquierda del topbar. */
const ROUTE_TITLES: Array<{ match: RegExp; title: string }> = [
  { match: /^\/dashboard/,            title: "Dashboard" },
  { match: /^\/supervisor\/fatigue/,  title: "Fatiga" },
  { match: /^\/repartos/,             title: "Repartos" },
  { match: /^\/inter-sucursal/,       title: "Inter-sucursal" },
  { match: /^\/viajes/,               title: "Viajes" },
  { match: /^\/vehicles/,             title: "Flota" },
  { match: /^\/branches/,             title: "Sucursales" },
  { match: /^\/zones/,                title: "Zonas" },
  { match: /^\/bulk-upload/,          title: "Importar CSV" },
  { match: /^\/admin\/users/,         title: "Usuarios" },
  { match: /^\/admin\/access-logs/,   title: "Log de accesos" },
  { match: /^\/organization/,         title: "Organización" },
  { match: /^\/routing-config/,       title: "Configuración de ruteo" },
  { match: /^\/ml-config/,            title: "Configuración de ML" },
  { match: /^\/fatigue-config/,       title: "Configuración de fatiga" },
  { match: /^\/pricing-config/,       title: "Tarifario" },
  { match: /^\/system-config/,        title: "Configuración del sistema" },
  { match: /^\/shipments\//,          title: "Detalle de envío" },
  { match: /^\/new/,                  title: "Nuevo envío" },
  { match: /^\/drafts/,               title: "Borradores" },
  { match: /^\/notifications/,        title: "Notificaciones" },
  { match: /^\/profile/,              title: "Mi perfil" },
  { match: /^\/inter-branch-trips/,   title: "Recepción de viaje" },
  { match: /^\/$/,                    title: "Envíos" },
];

/**
 * Topbar slim que se renderiza dentro del wrapper del AppShell — el offset
 * horizontal (sidebar) lo maneja el wrapper, no este componente.
 *
 * Las páginas pueden inyectar acciones a la derecha (entre el título y el
 * NotificationBell) usando <TopbarActions>...</TopbarActions> desde
 * `./topbarContext`.
 */
export function Topbar() {
  const isMobile = useIsMobile();
  const location = useLocation();
  const { user } = useAuth();
  const title = titleForPath(location.pathname);
  const subtitle = user ? subtitleForPath(location.pathname, user.role) : "";
  const registerSlot = useTopbarSlotRef();

  return (
      <header
        className={cn(
          "sticky top-0 z-50 h-14",
          "bg-[var(--topbar-bg)]",
          "backdrop-saturate-[1.8] backdrop-blur-lg",
          "border-b border-[var(--border)]",
          "grid grid-cols-[1fr_auto_1fr] items-center gap-4",
          isMobile ? "pr-3 pl-[60px]" : "px-6",
        )}
      >
        <div />

        <div className="min-w-0 flex flex-col items-center">
          <h1 className="text-[15px] font-bold text-[var(--text-heading)] m-0 truncate max-w-[180px] sm:max-w-[320px] leading-tight">
            {title}
          </h1>
          {subtitle && !isMobile && (
            <p className="text-[11px] text-[var(--text-muted)] m-0 truncate">{subtitle}</p>
          )}
        </div>

        <div className="flex items-center gap-3 justify-end">
          <div ref={registerSlot} className="flex items-center gap-2" />
          <ThemeToggle compact={isMobile} />
          <NotificationBell />
        </div>
      </header>
  );
}
