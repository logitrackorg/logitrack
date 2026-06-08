import { useLocation } from "react-router-dom";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";
import { useIsMobile } from "../hooks/useIsMobile";
import { useTopbarSlotRef } from "../hooks/useTopbarSlot";
import { cn } from "../lib/utils";

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

function titleForPath(pathname: string): string {
  const found = ROUTE_TITLES.find((r) => r.match.test(pathname));
  return found?.title ?? "";
}

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
  const title = titleForPath(location.pathname);
  const registerSlot = useTopbarSlotRef();

  return (
    <header
      className={cn(
        "sticky top-0 z-50 h-14",
        "bg-[var(--topbar-bg)]",
        "backdrop-saturate-[1.8] backdrop-blur-lg",
        "border-b border-[var(--border)]",
        "flex items-center gap-4",
        isMobile ? "pr-3 pl-[60px]" : "px-6",
      )}
    >
      <h1 className="text-[15px] font-bold text-[var(--text-heading)] m-0 truncate max-w-[180px] sm:max-w-[280px]">
        {title}
      </h1>

      {/* Slot para acciones de la página activa (portal target) */}
      <div
        ref={registerSlot}
        className="flex-1 min-w-0 flex items-center justify-end gap-2"
      />

      <div className="flex items-center gap-3 shrink-0">
        <ThemeToggle compact={isMobile} />
        <NotificationBell />
      </div>
    </header>
  );
}
