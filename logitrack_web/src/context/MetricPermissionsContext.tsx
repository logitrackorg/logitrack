import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { metricPermissionsApi, METRIC_PERMISSIONS_SSE_URL } from "../api/metricPermissions";
import { useAuth } from "./AuthContext";

interface MetricPermissionsContextValue {
  /** Returns true when the current user's role can see the given metric. */
  hasMetricPermission: (metricId: string) => boolean;
  /** Raw map of metric_id → is_visible for the current user. */
  permissions: Record<string, boolean>;
}

const MetricPermissionsContext = createContext<MetricPermissionsContextValue>({
  hasMetricPermission: () => true,
  permissions: {},
});

export function MetricPermissionsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  // Stable primitive to use as effect dependency — avoids re-running on unrelated user field changes.
  const userId = user?.id ?? null;

  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const esRef = useRef<EventSource | null>(null);

  const fetchPermissions = useCallback(() => {
    metricPermissionsApi.getMyPermissions().then(setPermissions).catch(() => {});
  }, []);

  // Re-fetch when the logged-in user changes (login / logout / account switch).
  useEffect(() => {
    if (userId) {
      fetchPermissions();
    } else {
      // User logged out — clear permissions so tabs revert to the default-all-visible state.
      setPermissions({});
    }
  }, [userId, fetchPermissions]);

  // Re-open SSE when the user (or token) changes.
  // Cleanup on logout closes the old connection so stale events don't leak to the next session.
  useEffect(() => {
    if (!userId) return;
    const token = localStorage.getItem("token");
    if (!token) return;

    const es = new EventSource(`${METRIC_PERMISSIONS_SSE_URL}?token=${token}`);
    esRef.current = es;

    es.addEventListener("permissions_updated", () => {
      fetchPermissions();
    });

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [userId, fetchPermissions]);

  const hasMetricPermission = useCallback(
    (metricId: string) => permissions[metricId] !== false,
    [permissions],
  );

  return (
    <MetricPermissionsContext.Provider value={{ hasMetricPermission, permissions }}>
      {children}
    </MetricPermissionsContext.Provider>
  );
}

export function useMetricPermissions() {
  return useContext(MetricPermissionsContext);
}
