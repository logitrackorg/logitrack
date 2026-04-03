import { useState } from "react";
import { shipmentApi, type Shipment, type ShipmentEvent, type ShipmentStatus } from "../api/shipments";
import { branchApi, type Branch } from "../api/branches";
import { StatusBadge } from "../components/StatusBadge";
import { fmtDate, fmtDateTime } from "../utils/date";
import { useIsMobile } from "../hooks/useIsMobile";

export function PublicTracking() {
  const isMobile = useIsMobile();
  const [query, setQuery] = useState("");
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [events, setEvents] = useState<ShipmentEvent[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useState(() => { branchApi.list().then(setBranches); });

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setShipment(null);
    setEvents([]);
    try {
      const [s, ev] = await Promise.all([
        shipmentApi.get(query.trim().toUpperCase()),
        shipmentApi.getEvents(query.trim().toUpperCase()),
      ]);
      setShipment(s);
      setEvents(ev);
    } catch {
      setError("Shipment not found. Please check the tracking ID.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: isMobile ? "24px auto" : "48px auto", padding: "0 16px" }}>
      <h1 style={{ textAlign: "center", marginBottom: 8 }}>Track your shipment</h1>
      <p style={{ textAlign: "center", color: "#6b7280", marginBottom: 32 }}>
        Enter your tracking ID to see the current status
      </p>

      <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, marginBottom: 32 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. LT-90CCE50E"
          style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 15 }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", cursor: "pointer", fontWeight: 600 }}
        >
          {loading ? "..." : "Track"}
        </button>
      </form>

      {error && <p style={{ color: "#ef4444", textAlign: "center" }}>{error}</p>}

      {shipment && (
        <>
          {/* Shipment info */}
          <div style={{ background: "#f9fafb", borderRadius: 10, padding: 20, marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <code style={{ fontSize: 18, fontWeight: 700 }}>{shipment.tracking_id}</code>
              <StatusBadge status={shipment.status} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "8px 16px", fontSize: 14 }}>
              <InfoRow label="From" value={`${shipment.sender.address.city}, ${shipment.sender.address.province}`} />
              <InfoRow label="To" value={`${shipment.recipient.address.city}, ${shipment.recipient.address.province}`} />
              <InfoRow label="Sender" value={shipment.sender.name} />
              <InfoRow label="Recipient" value={shipment.recipient.name} />
            </div>
          </div>

          {/* Route timeline from real events */}
          <RouteTimeline events={events} destinationCity={shipment.recipient.address.city} destinationProvince={shipment.recipient.address.province} branches={branches} />

          {/* Event history */}
          {events.length > 0 && (
            <>
              <h2 style={{ fontSize: "1rem", marginBottom: 12 }}>Event History</h2>
              <div style={{ display: "grid", gap: 8 }}>
                {[...events].reverse().map((ev) => (
                  <div key={ev.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 600 }}>
                        {ev.from_status ? `${ev.from_status} → ${ev.to_status}` : ev.to_status}
                      </span>
                      <span style={{ color: "#6b7280" }}>{fmtDateTime(ev.timestamp)}</span>
                    </div>
                    {ev.notes && <p style={{ margin: "4px 0 0", color: "#4b5563" }}>{ev.notes}</p>}
                    <p style={{ margin: "4px 0 0", color: "#9ca3af" }}>by {ev.changed_by || "system"}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function RouteTimeline({ events, destinationCity, destinationProvince, branches }: { events: ShipmentEvent[]; destinationCity: string; destinationProvince: string; branches: Branch[] }) {
  const stops: { location: string; status: ShipmentStatus; timestamp: string }[] = [];
  const seen = new Set<string>();
  for (const ev of events) {
    const loc = ev.location || ev.to_status;
    if (loc && !seen.has(loc)) {
      seen.add(loc);
      stops.push({ location: loc, status: ev.to_status, timestamp: ev.timestamp });
    }
  }
  if (stops.length === 0) return null;

  const statusColors: Record<ShipmentStatus, string> = {
    pending: "#9ca3af", in_progress: "#f59e0b", pre_transit: "#06b6d4", in_transit: "#3b82f6", at_branch: "#8b5cf6", delivering: "#f97316", delivery_failed: "#ef4444", delivered: "#10b981", ready_for_pickup: "#0891b2", ready_for_return: "#7c3aed", returned: "#6b7280", cancelled: "#b91c1c",
  };
  const isDelivered = stops[stops.length - 1].status === "delivered";

  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: "0.95rem", marginBottom: 14 }}>Route</h2>
      <div style={{ display: "flex", alignItems: "center", overflowX: "auto", paddingBottom: 4 }}>
        {stops.map((stop, i) => {
          const isCurrent = i === stops.length - 1;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
              <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 4 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: "50%",
                  background: isCurrent ? statusColors[stop.status] : "#e5e7eb",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: isCurrent ? `0 0 0 3px ${statusColors[stop.status]}33` : "none",
                }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: isCurrent ? "#fff" : "#9ca3af" }}>
                    {stop.status === "delivered" ? "✓" : i + 1}
                  </span>
                </div>
                <div style={{ textAlign: "center" as const, maxWidth: 80 }}>
                  {(() => {
                    const b = branches.find((x) => x.city === stop.location);
                    return (
                      <>
                        <div style={{ fontSize: 11, fontWeight: isCurrent ? 700 : 500, color: isCurrent ? "#1e3a5f" : "#6b7280", whiteSpace: "nowrap" as const }}>{b?.city ?? stop.location}</div>
                        {b?.province && <div style={{ fontSize: 10, color: "#9ca3af", whiteSpace: "nowrap" as const }}>{b.province}</div>}
                      </>
                    );
                  })()}
                  <div style={{ fontSize: 10, color: "#9ca3af" }}>{fmtDate(stop.timestamp)}</div>
                </div>
              </div>
              {i < stops.length - 1 && <div style={{ width: 36, height: 2, background: "#d1d5db", flexShrink: 0, margin: "0 4px", marginBottom: 24 }} />}
            </div>
          );
        })}
        {!isDelivered && (
          <>
            <div style={{ width: 36, height: 2, background: "#e5e7eb", flexShrink: 0, margin: "0 4px", marginBottom: 24, borderStyle: "dashed" }} />
            <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 4, flexShrink: 0 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#f9fafb", border: "3px dashed #d1d5db", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 14, color: "#d1d5db" }}>🏁</span>
              </div>
              <div style={{ fontSize: 11, color: "#9ca3af", whiteSpace: "nowrap" as const }}>{destinationCity}</div>
              <div style={{ fontSize: 10, color: "#9ca3af", whiteSpace: "nowrap" as const }}>{destinationProvince}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={{ color: "#9ca3af", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
      <div style={{ fontWeight: 500 }}>{value}</div>
    </div>
  );
}
