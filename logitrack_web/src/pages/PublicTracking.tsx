import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { publicTrackingApi } from "../api/publicTracking";
import type { Shipment, ShipmentEvent, ShipmentStatus } from "../api/shipments";
import type { Branch } from "../api/branches";
import { StatusBadge } from "../components/StatusBadge";
import { fmtDateTime } from "../utils/date";
import { useIsMobile } from "../hooks/useIsMobile";

// User-facing status labels (no internal domain language)
const STATUS_LABELS: Record<ShipmentStatus, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  pre_transit: "Preparing Dispatch",
  in_transit: "In Transit",
  at_branch: "At Logistics Center",
  delivering: "Out for Delivery",
  delivery_failed: "Delivery Attempt Failed",
  delivered: "Delivered",
  ready_for_pickup: "Ready for Pickup",
  ready_for_return: "Ready for Return",
  returned: "Returned",
  cancelled: "Cancelled",
};

interface EventDescription {
  icon: string;
  title: string;
  subtitle?: string; // city + province line
}

function describeEvent(ev: ShipmentEvent, branches: Branch[]): EventDescription {
  const loc = ev.location;
  const branch = loc
    ? (branches.find((b) => b.address.city === loc) ?? branches.find((b) => b.id === loc))
    : undefined;
  const cityLine = branch
    ? `${branch.address.city}, ${branch.province}`
    : loc ?? undefined;

  const { from_status: from, to_status: to } = ev;

  // Creation
  if (!from && to === "in_progress") {
    return { icon: "📦", title: "Shipment registered", subtitle: cityLine };
  }
  if (!from && to === "pending") {
    return { icon: "📋", title: "Draft created" };
  }

  // Confirmation / ready to dispatch
  if (from === "pending" && to === "in_progress") {
    return { icon: "✅", title: "Shipment confirmed", subtitle: cityLine };
  }

  // Loaded onto vehicle
  if (to === "pre_transit") {
    return { icon: "🚛", title: "Loaded and ready for dispatch", subtitle: cityLine };
  }

  // Departed
  if (to === "in_transit") {
    const dest = cityLine ?? loc;
    return {
      icon: "🚀",
      title: dest ? `Departed — heading to ${dest}` : "Departed — in transit",
    };
  }

  // Arrived at a logistics center
  if (to === "at_branch") {
    return { icon: "🏭", title: "Arrived at logistics center", subtitle: cityLine };
  }

  // Out for delivery
  if (to === "delivering") {
    return { icon: "🛵", title: "Out for last-mile delivery", subtitle: cityLine };
  }

  // Delivered
  if (to === "delivered") {
    return { icon: "🎉", title: "Shipment delivered" };
  }

  // Delivery failed
  if (to === "delivery_failed") {
    return { icon: "⚠️", title: "Delivery attempt was unsuccessful" };
  }

  // Ready for pickup at branch
  if (to === "ready_for_pickup") {
    return { icon: "📬", title: "Available for pickup at logistics center", subtitle: cityLine };
  }

  // Ready for return to sender
  if (to === "ready_for_return") {
    return { icon: "↩️", title: "Awaiting return to sender", subtitle: cityLine };
  }

  // Returned
  if (to === "returned") {
    return { icon: "📤", title: "Returned to sender" };
  }

  // Cancelled
  if (to === "cancelled") {
    return { icon: "🚫", title: "Shipment cancelled" };
  }

  // Fallback — should never reach here for known statuses
  return { icon: "•", title: STATUS_LABELS[to] ?? to, subtitle: cityLine };
}

export function PublicTracking() {
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("id") ?? "");
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [events, setEvents] = useState<ShipmentEvent[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    publicTrackingApi.getBranches().then(setBranches).catch(() => {});
  }, []);

  useEffect(() => {
    const id = searchParams.get("id");
    if (id) runSearch(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSearch = async (trackingId: string) => {
    setLoading(true);
    setError("");
    setShipment(null);
    setEvents([]);
    try {
      const [s, ev] = await Promise.all([
        publicTrackingApi.getShipment(trackingId.trim().toUpperCase()),
        publicTrackingApi.getEvents(trackingId.trim().toUpperCase()),
      ]);
      setShipment(s);
      setEvents(ev.filter((e) => e.event_type !== "edited"));
    } catch {
      setError("Shipment not found. Please check the tracking ID and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearchParams({ id: query.trim().toUpperCase() });
    runSearch(query.trim());
  };

  const chronological = [...events].reverse();

  return (
    <div style={{ minHeight: "100vh", background: "#f0f4f8", fontFamily: "system-ui, sans-serif" }}>
      {/* Header */}
      <header style={{
        background: "#1e3a5f", color: "#fff",
        padding: isMobile ? "16px 20px" : "18px 40px",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{ fontWeight: 900, fontSize: isMobile ? 18 : 22, letterSpacing: 1 }}>LogiTrack</span>
        <span style={{ color: "#93c5fd", fontSize: isMobile ? 13 : 15, fontWeight: 400 }}>· Shipment Tracking</span>
      </header>

      {/* Hero search */}
      <div style={{
        background: "linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)",
        padding: isMobile ? "32px 20px" : "52px 40px",
        textAlign: "center",
      }}>
        <h1 style={{ color: "#fff", margin: "0 0 8px", fontSize: isMobile ? 22 : 30, fontWeight: 800 }}>
          Where is my shipment?
        </h1>
        <p style={{ color: "#bfdbfe", margin: "0 0 28px", fontSize: isMobile ? 14 : 16 }}>
          Enter your tracking number to see its current status
        </p>
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, maxWidth: 560, margin: "0 auto" }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. LT-A1B2C3D4"
            style={{
              flex: 1, padding: isMobile ? "12px 14px" : "14px 18px",
              borderRadius: 10, border: "none", fontSize: isMobile ? 15 : 16,
              outline: "none", boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            }}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              background: "#f59e0b", color: "#1e3a5f", border: "none", borderRadius: 10,
              padding: isMobile ? "12px 18px" : "14px 28px",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 700, fontSize: isMobile ? 14 : 16,
              whiteSpace: "nowrap", opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Searching..." : "Track"}
          </button>
        </form>
      </div>

      {/* Results */}
      <div style={{ maxWidth: 680, margin: "0 auto", padding: isMobile ? "24px 16px" : "40px 20px" }}>
        {error && (
          <div style={{
            background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 10,
            padding: "16px 20px", color: "#b91c1c", textAlign: "center", fontSize: 15,
          }}>
            {error}
          </div>
        )}

        {shipment && (
          <>
            {/* Status summary card */}
            <div style={{
              background: "#fff", borderRadius: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
              padding: isMobile ? 20 : 28, marginBottom: 20,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
                    Tracking number
                  </div>
                  <code style={{ fontSize: isMobile ? 18 : 22, fontWeight: 800, color: "#1e3a5f" }}>
                    {shipment.tracking_id}
                  </code>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                  <StatusBadge status={shipment.status} />
                  <span style={{ fontSize: 12, color: "#6b7280" }}>{STATUS_LABELS[shipment.status]}</span>
                </div>
              </div>
              <div style={{ marginTop: 16, display: "flex", gap: 24, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5 }}>From</div>
                  <div style={{ fontWeight: 600, color: "#111827", marginTop: 2 }}>
                    {shipment.sender.address.city}, {shipment.sender.address.province}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5 }}>To</div>
                  <div style={{ fontWeight: 600, color: "#111827", marginTop: 2 }}>
                    {shipment.recipient.address.city}, {shipment.recipient.address.province}
                  </div>
                </div>
              </div>
            </div>

            {/* Event history — vertical timeline */}
            {chronological.length > 0 && (
              <div style={{
                background: "#fff", borderRadius: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
                padding: isMobile ? "20px 16px" : "28px 28px",
              }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: "#1e3a5f", marginTop: 0, marginBottom: 24 }}>
                  Shipment history
                </h2>
                <div style={{ position: "relative" }}>
                  {/* Vertical line */}
                  <div style={{
                    position: "absolute", left: 19, top: 0, bottom: 0,
                    width: 2, background: "#e5e7eb", zIndex: 0,
                  }} />

                  <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    {chronological.map((ev, i) => {
                      const isFirst = i === 0;
                      const desc = describeEvent(ev, branches);
                      return (
                        <div key={ev.id} style={{ display: "flex", gap: 16, position: "relative", paddingBottom: i < chronological.length - 1 ? 24 : 0 }}>
                          {/* Circle */}
                          <div style={{ flexShrink: 0, zIndex: 1 }}>
                            <div style={{
                              width: 40, height: 40, borderRadius: "50%",
                              background: isFirst ? "#1e3a5f" : "#f3f4f6",
                              border: isFirst ? "none" : "2px solid #e5e7eb",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: 18,
                              boxShadow: isFirst ? "0 0 0 4px #dbeafe" : "none",
                            }}>
                              {desc.icon}
                            </div>
                          </div>

                          {/* Content */}
                          <div style={{ paddingTop: 8 }}>
                            <div style={{
                              fontWeight: isFirst ? 700 : 500,
                              fontSize: 14,
                              color: isFirst ? "#111827" : "#374151",
                              lineHeight: 1.3,
                            }}>
                              {desc.title}
                            </div>
                            {desc.subtitle && (
                              <div style={{ fontSize: 13, color: "#6b7280", marginTop: 3 }}>
                                📍 {desc.subtitle}
                              </div>
                            )}
                            <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
                              {fmtDateTime(ev.timestamp)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {!shipment && !error && !loading && (
          <div style={{ textAlign: "center", color: "#9ca3af", marginTop: 32, fontSize: 15 }}>
            Enter a tracking number above to get started.
          </div>
        )}
      </div>

      {/* Footer */}
      <footer style={{
        textAlign: "center", padding: "24px 20px", color: "#9ca3af", fontSize: 13,
        borderTop: "1px solid #e5e7eb", marginTop: 40,
      }}>
        © {new Date().getFullYear()} LogiTrack · Shipment tracking
      </footer>
    </div>
  );
}
