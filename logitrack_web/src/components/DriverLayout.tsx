import { Outlet, useLocation } from "react-router-dom";
import { DriverShell } from "./DriverShell";

const TITLE_MAP: Record<string, string> = {
  "/driver/route": "Mi ruta",
  "/driver/trip": "Mi viaje",
  "/driver/scan": "Escanear vehículo",
  "/driver/shipments": "Detalle de envío",
  "/profile": "Mi perfil",
};

export function DriverLayout() {
  const { pathname } = useLocation();

  // Match the path prefix: /driver/shipments/LT-XXX → "Detalle de envío"
  let title = "LogiTrack";
  if (pathname.startsWith("/driver/shipments")) {
    title = "Detalle de envío";
  } else {
    title = TITLE_MAP[pathname];
    if (!title) {
      // Check prefix match for other dynamic routes
      for (const [prefix, t] of Object.entries(TITLE_MAP)) {
        if (pathname.startsWith(prefix)) {
          title = t;
          break;
        }
      }
    }
  }

  return (
    <DriverShell title={title}>
      <Outlet />
    </DriverShell>
  );
}
