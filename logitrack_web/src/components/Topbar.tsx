import { useLocation } from "react-router-dom";
import { NotificationBell } from "./NotificationBell";
import { useIsMobile } from "../hooks/useIsMobile";
import { useTopbarSlotRef } from "../hooks/useTopbarSlot";

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
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        height: 56,
        background: "rgba(255,255,255,0.92)",
        backdropFilter: "saturate(180%) blur(8px)",
        WebkitBackdropFilter: "saturate(180%) blur(8px)",
        borderBottom: "1px solid #e5e7eb",
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: isMobile ? "0 12px 0 60px" : "0 24px",
      }}
    >
      <h1 style={{
        fontSize: 15,
        fontWeight: 700,
        color: "#0f2744",
        margin: 0,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        flexShrink: 0,
      }}>
        {title}
      </h1>

      {/* Slot para acciones de la página activa (portal target) */}
      <div
        ref={registerSlot}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 8,
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <NotificationBell />
      </div>
    </header>
  );
}
