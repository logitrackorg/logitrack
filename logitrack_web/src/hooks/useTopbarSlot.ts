import { useContext } from "react";
import { TopbarContext } from "../components/topbarContext";

/**
 * Callback ref que el Topbar usa para registrar el DOM node donde se montarán
 * las acciones de la página activa (el portal target).
 */
export function useTopbarSlotRef() {
  const { registerSlot } = useContext(TopbarContext);
  return registerSlot;
}
