import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * Slot system para que las páginas inyecten acciones (botones, badges) en la
 * parte derecha del Topbar. Implementado con portal sobre un DOM node provisto
 * por el Topbar.
 *
 * Uso desde una página:
 *
 *   <TopbarActions>
 *     <button>+ Nuevo envío</button>
 *   </TopbarActions>
 *
 * El portal se limpia automáticamente al desmontarse la página. El hook que
 * el Topbar usa para registrar el slot está en hooks/useTopbarSlot.ts para
 * cumplir con la regla de Fast Refresh (un archivo, solo componentes).
 */

type Ctx = {
  slotEl: HTMLElement | null;
  registerSlot: (el: HTMLElement | null) => void;
};

// eslint-disable-next-line react-refresh/only-export-components
export const TopbarContext = createContext<Ctx>({
  slotEl: null,
  registerSlot: () => {},
});

export function TopbarProvider({ children }: { children: ReactNode }) {
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  const registerSlot = useCallback((el: HTMLElement | null) => {
    setSlotEl(el);
  }, []);
  return (
    <TopbarContext.Provider value={{ slotEl, registerSlot }}>
      {children}
    </TopbarContext.Provider>
  );
}

/**
 * Componente que las páginas usan para renderizar contenido en el slot del
 * Topbar. Si el Topbar todavía no montó, no renderiza nada (sin error).
 */
export function TopbarActions({ children }: { children: ReactNode }) {
  const { slotEl } = useContext(TopbarContext);
  if (!slotEl) return null;
  return createPortal(children, slotEl);
}
