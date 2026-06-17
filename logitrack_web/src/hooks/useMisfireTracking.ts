import { useCallback, useEffect, useRef, useState } from "react";

export interface UseMisfireTrackingResult {
  /** Captured misfire count at the moment checkin was triggered. */
  misfireCount: number;
  /** Returns the live misfire ref value (does not cause re-render). */
  getMisfires: () => number;
  /** Resets the misfire ref counter to 0. */
  resetMisfires: () => void;
  /** Whether the mid-route checkin overlay is active. */
  checkinTriggered: boolean;
  /** Sets checkinTriggered=true and stores the captured misfire count. */
  triggerCheckin: (misfires: number) => void;
  /** Sets checkinTriggered=false (hides the overlay). */
  closeCheckin: () => void;
}

/**
 * Tracks misfire clicks (document-level clicks while checkin is NOT active)
 * and manages the mid-route checkin overlay state.
 *
 * Extracted from DriverRoute.tsx to be reusable across driver-facing views.
 */
export function useMisfireTracking(): UseMisfireTrackingResult {
  const misfireRef = useRef(0);

  const [checkinTriggered, setCheckinTriggered] = useState(false);
  const [misfireCount, setMisfireCount] = useState(0);

  // Ref mirror for the document listener to avoid stale closure.
  const checkinRef = useRef(false);
  useEffect(() => {
    checkinRef.current = checkinTriggered;
  }, [checkinTriggered]);

  // Global click listener: increment misfire counter when checkin is NOT active.
  useEffect(() => {
    const handleGlobalClick = () => {
      if (!checkinRef.current) misfireRef.current++;
    };
    document.addEventListener("click", handleGlobalClick);
    return () => document.removeEventListener("click", handleGlobalClick);
  }, []);

  const getMisfires = useCallback(() => misfireRef.current, []);
  const resetMisfires = useCallback(() => { misfireRef.current = 0; }, []);

  const triggerCheckin = useCallback((misfires: number) => {
    setMisfireCount(misfires);
    setCheckinTriggered(true);
  }, []);

  const closeCheckin = useCallback(() => {
    setCheckinTriggered(false);
  }, []);

  return {
    misfireCount,
    getMisfires,
    resetMisfires,
    checkinTriggered,
    triggerCheckin,
    closeCheckin,
  };
}
