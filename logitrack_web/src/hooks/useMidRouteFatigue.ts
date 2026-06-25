import { useState } from "react";
import { driverApi } from "../api/driver";

export function useMidRouteFatigue() {
  const [showGate, setShowGate] = useState(false);
  const [misfireCount, setMisfireCount] = useState(0);
  const [requiresSleepData, setRequiresSleepData] = useState(true);

  // `force`: omite la consulta de elegibilidad y muestra el gate sí o sí.
  // Se usa en los check-ins OBLIGATORIOS de cada parada intermedia inter-sucursal,
  // donde el test debe aparecer siempre (no depende de horas transcurridas / misfires).
  const triggerGate = async (misfires: number, opts?: { force?: boolean }): Promise<boolean> => {
    let requireTest = opts?.force ?? false;
    if (!requireTest) {
      try {
        const eligibility = await driverApi.getTestEligibility({ misfires });
        requireTest = eligibility.require_test;
      } catch {
        // network error → continue without blocking
      }
    }
    if (requireTest) {
      try {
        const checkin = await driverApi
          .getTodayCheckin()
          .catch(() => ({ ok: false, requires_sleep_data: true }));
        setRequiresSleepData(checkin.requires_sleep_data ?? true);
      } catch {
        setRequiresSleepData(true);
      }
      setMisfireCount(misfires);
      setShowGate(true);
      return true;
    }
    driverApi.resetMisfires().catch(() => {});
    return false;
  };

  const closeGate = () => {
    setShowGate(false);
    setRequiresSleepData(false);
    driverApi.resetMisfires().catch(() => {});
  };

  return { showGate, misfireCount, requiresSleepData, triggerGate, closeGate };
}
