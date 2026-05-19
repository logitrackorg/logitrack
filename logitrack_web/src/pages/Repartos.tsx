import { Routing } from "./Routing";

// Página "Repartos del día" — solo última milla.
// Reusa Routing.tsx con mode="last_mile" para ocultar la pestaña inter-sucursal.
export function Repartos() {
  return <Routing mode="last_mile" />;
}
