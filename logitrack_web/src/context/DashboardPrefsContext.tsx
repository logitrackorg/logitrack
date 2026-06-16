import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { dashboardPrefsApi, type DashboardMetricPref } from "../api/dashboardPrefs";
import { useAuth } from "./AuthContext";

interface DashboardPrefsContextValue {
  /** null = not yet loaded (use default order). Array = loaded preferences. */
  prefs: DashboardMetricPref[] | null;
  /** Updates local state immediately and persists in background. */
  updatePrefs: (newPrefs: DashboardMetricPref[]) => void;
}

const DashboardPrefsContext = createContext<DashboardPrefsContextValue>({
  prefs: null,
  updatePrefs: () => {},
});

export function DashboardPrefsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [prefs, setPrefs] = useState<DashboardMetricPref[] | null>(null);

  const fetchPrefs = useCallback(() => {
    dashboardPrefsApi.getPreferences().then(setPrefs).catch(() => {});
  }, []);

  useEffect(() => {
    if (userId) {
      fetchPrefs();
    } else {
      setPrefs(null);
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

  return (
    <DashboardPrefsContext.Provider value={{ prefs, updatePrefs }}>
      {children}
    </DashboardPrefsContext.Provider>
  );
}

export function useDashboardPrefs() {
  return useContext(DashboardPrefsContext);
}
