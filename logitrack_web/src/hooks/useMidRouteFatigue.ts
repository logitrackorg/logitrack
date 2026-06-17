import { useState } from "react";
import { driverApi } from "../api/driver";

export function useMidRouteFatigue(_driverId: string) {
  const [showGate, setShowGate] = useState(false);
  const [misfireCount, setMisfireCount] = useState(0);
  const [requiresSleepData, setRequiresSleepData] = useState(true);

  const triggerGate = async (misfires: number): Promise<boolean> => {
    let requireTest = false;
    try {
      const eligibility = await driverApi.getTestEligibility({ misfires });
      requireTest = eligibility.require_test;
    } catch {
      // network error → continue without blocking
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
