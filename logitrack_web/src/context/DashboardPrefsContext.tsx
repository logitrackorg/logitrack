import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { dashboardPrefsApi, type DashboardMetricPref } from "../api/dashboardPrefs";
import { useAuth } from "./AuthContext";

interface DashboardPrefsContextValue {
  /** null = not yet loaded (use default order). Array = loaded preferences. */
  prefs: DashboardMetricPref[] | null;
  /** Updates local state immediately and persists in background. */
  updatePrefs: (newPrefs: DashboardMetricPref[]) => void;
  /** true when the admin reset this user's preferences and they haven't acknowledged yet. */
  wasResetByAdmin: boolean;
  /** Clears the reset notification locally + calls PATCH in background. */
  clearResetFlag: () => void;
}

const DashboardPrefsContext = createContext<DashboardPrefsContextValue>({
  prefs: null,
  updatePrefs: () => {},
  wasResetByAdmin: false,
  clearResetFlag: () => {},
});

export function DashboardPrefsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [prefs, setPrefs] = useState<DashboardMetricPref[] | null>(null);
  const [wasResetByAdmin, setWasResetByAdmin] = useState(false);

  const fetchPrefs = useCallback(() => {
    Promise.all([
      dashboardPrefsApi.getPreferences(),
      dashboardPrefsApi.getResetStatus(),
    ])
      .then(([prefData, resetStatus]) => {
        setPrefs(prefData);
        setWasResetByAdmin(resetStatus.was_reset_by_admin);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (userId) {
      fetchPrefs();
    } else {
      setPrefs(null);
      setWasResetByAdmin(false);
    }
  }, [userId, fetchPrefs]);

  const updatePrefs = useCallback((newPrefs: DashboardMetricPref[]) => {
    setPrefs(newPrefs);
    dashboardPrefsApi
      .savePreferences(
        newPrefs.map((p) => ({
          metric_id: p.metric_id,
          sort_order: p.sort_order,
          is_hidden: p.is_hidden,
        })),
      )
      .catch(() => {});
  }, []);

  const clearResetFlag = useCallback(() => {
    setWasResetByAdmin(false);
    dashboardPrefsApi.clearResetFlag().catch(() => {});
  }, []);

  return (
    <DashboardPrefsContext.Provider value={{ prefs, updatePrefs, wasResetByAdmin, clearResetFlag }}>
      {children}
    </DashboardPrefsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDashboardPrefs() {
  return useContext(DashboardPrefsContext);
}
