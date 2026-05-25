import { useEffect, useState } from "react";
import { useIsMobile } from "../hooks/useIsMobile";

export const SIDEBAR_RAIL_WIDTH = 68;
export const SIDEBAR_EXPANDED_WIDTH = 240;
export const SIDEBAR_HOVER_DELAY_MS = 180;

/** localStorage key for the persistent "pinned expanded" preference. */
export const SIDEBAR_PINNED_STORAGE_KEY = "sidebar:pinned";

/** Event name used to broadcast pinned-state changes between sibling components. */
export const SIDEBAR_PINNED_EVENT = "sidebar:pinned-change";

/** Reads the persisted pinned flag once (safe for SSR). */
export function readPinnedFlag(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(SIDEBAR_PINNED_STORAGE_KEY) === "1";
}

/**
 * Width visible al main content. En mobile la sidebar es overlay (no empuja),
 * en desktop devuelve rail (colapsado) o expanded (fijado).
 */
export function useSidebarOffset(): number {
  const isMobile = useIsMobile();
  const [pinned, setPinned] = useState<boolean>(readPinnedFlag);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ pinned: boolean }>).detail;
      setPinned(detail.pinned);
    };
    window.addEventListener(SIDEBAR_PINNED_EVENT, handler);
    return () => window.removeEventListener(SIDEBAR_PINNED_EVENT, handler);
  }, []);
  if (isMobile) return 0;
  return pinned ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_RAIL_WIDTH;
}
