import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Package, CheckCheck, X } from "lucide-react";
import { notificationApi, type Notification } from "../api/notifications";

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days} d`;
}

function NotifIcon({ type }: { type: string }) {
  if (type === "shipment_received") {
    return <Package size={16} color="#60a5fa" />;
  }
  return <Bell size={16} color="#94a3b8" />;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const fetchCount = useCallback(async () => {
    try {
      const data = await notificationApi.unreadCount();
      setUnreadCount(data.count);
    } catch {
      // silently ignore
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await notificationApi.list({ limit: 10, offset: 0 });
      setNotifications(data.notifications ?? []);
    } catch {
      // silently ignore
    }
  }, []);

  // SSE: push updates in real time. Falls back to 60-second polling if the
  // connection drops or the browser doesn't support EventSource.
  useEffect(() => {
    fetchCount(); // initial load

    const token = localStorage.getItem("token");
    const base = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1";
    const url = `${base}/notifications/stream?token=${encodeURIComponent(token ?? "")}`;

    let es: EventSource | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const startSSE = () => {
      es = new EventSource(url);
      es.addEventListener("notification", () => fetchCount());
      es.onerror = () => {
        es?.close();
        es = null;
        // If SSE fails, fall back to polling every 60 s
        if (!pollInterval) {
          pollInterval = setInterval(fetchCount, 60_000);
        }
      };
    };

    if (typeof EventSource !== "undefined" && token) {
      startSSE();
    } else {
      // No EventSource support — use polling only
      pollInterval = setInterval(fetchCount, 60_000);
    }

    return () => {
      es?.close();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [fetchCount]);

  // Close panel on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleToggle = () => {
    if (!open) {
      fetchNotifications();
      fetchCount();
    }
    setOpen((v) => !v);
  };

  const handleMarkAllRead = async () => {
    await notificationApi.markAllRead();
    setUnreadCount(0);
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }))
    );
  };

  const handleItemClick = async (n: Notification) => {
    if (!n.read_at) {
      await notificationApi.markRead(n.id);
      setUnreadCount((c) => Math.max(0, c - 1));
      setNotifications((prev) =>
        prev.map((item) =>
          item.id === n.id ? { ...item, read_at: new Date().toISOString() } : item
        )
      );
    }
    if (n.resource_id) {
      navigate(`/shipments/${n.resource_id}`);
    }
    setOpen(false);
  };

  return (
    <div ref={panelRef} style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      {/* Bell button */}
      <button
        onClick={handleToggle}
        title="Notificaciones"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "4px 6px",
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          position: "relative",
          color: "#cbd5e1",
        }}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              background: "#ef4444",
              color: "#fff",
              borderRadius: "50%",
              fontSize: 10,
              fontWeight: 700,
              minWidth: 16,
              height: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 3px",
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 360,
            background: "#0f2744",
            border: "1px solid #1e3a5f",
            borderRadius: 10,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            zIndex: 50,
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              borderBottom: "1px solid #1e3a5f",
            }}
          >
            <span style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 14 }}>
              Notificaciones
            </span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  title="Marcar todas como leídas"
                  style={{
                    background: "none",
                    border: "none",
                    color: "#60a5fa",
                    cursor: "pointer",
                    fontSize: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <CheckCheck size={14} />
                  Marcar todas
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", display: "flex" }}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Notification list */}
          <div style={{ maxHeight: 400, overflowY: "auto" }}>
            {notifications.length === 0 ? (
              <div style={{ padding: "24px 16px", textAlign: "center", color: "#64748b", fontSize: 13 }}>
                Sin notificaciones
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => handleItemClick(n)}
                  style={{
                    padding: "12px 16px",
                    borderBottom: "1px solid #1a2e4a",
                    cursor: "pointer",
                    background: n.read_at ? "transparent" : "rgba(96,165,250,0.07)",
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = n.read_at ? "transparent" : "rgba(96,165,250,0.07)")
                  }
                >
                  <div style={{ marginTop: 2, flexShrink: 0 }}>
                    <NotifIcon type={n.type} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          color: "#e2e8f0",
                          fontSize: 13,
                          fontWeight: n.read_at ? 400 : 600,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {n.title}
                      </span>
                      <span style={{ color: "#64748b", fontSize: 11, flexShrink: 0 }}>
                        {relativeTime(n.created_at)}
                      </span>
                    </div>
                    <div
                      style={{
                        color: "#94a3b8",
                        fontSize: 12,
                        marginTop: 2,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {n.body}
                    </div>
                  </div>
                  {!n.read_at && (
                    <div
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "#3b82f6",
                        flexShrink: 0,
                        marginTop: 6,
                      }}
                    />
                  )}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "10px 16px",
              borderTop: "1px solid #1e3a5f",
              textAlign: "center",
            }}
          >
            <button
              onClick={() => { navigate("/notifications"); setOpen(false); }}
              style={{
                background: "none",
                border: "none",
                color: "#60a5fa",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Ver todas
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
