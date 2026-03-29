import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  shipmentApi,
  type Shipment,
  type ShipmentEvent,
  type ShipmentStatus,
  type SaveDraftPayload,
  type ShipmentComment,
} from "../api/shipments";
import { usersApi } from "../api/users";
import type { User } from "../api/auth";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { branchApi, branchLabel, branchLabelById, type Branch } from "../api/branches";
import { customerApi, type Customer } from "../api/customers";
import { fmtDate, fmtDateTime } from "../utils/date";

const TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  pending:           [],
  in_progress:       ["in_transit"],
  in_transit:        ["at_branch"],
  at_branch:         ["in_transit", "delivering", "ready_for_pickup", "ready_for_return"],
  delivering:        ["delivered", "delivery_failed"],
  delivery_failed:   ["delivering", "at_branch"],
  delivered:         [],
  ready_for_pickup:  ["delivered", "in_transit"],
  ready_for_return:  ["returned"],
  returned:          [],
  cancelled:         [],
};

const STATUS_LABELS: Record<ShipmentStatus, string> = {
  pending:           "Draft",
  in_progress:       "In Progress",
  in_transit:        "In Transit",
  at_branch:         "At Branch",
  delivering:        "Delivering",
  delivery_failed:   "Delivery Failed",
  delivered:         "Delivered",
  ready_for_pickup:  "Ready for pickup",
  ready_for_return:  "Ready for return",
  returned:          "Returned",
  cancelled:         "Cancelled",
};

const PACKAGE_LABELS: Record<string, string> = {
  envelope: "Envelope", box: "Box", pallet: "Pallet",
};

export function ShipmentDetail() {
  const { hasRole, user } = useAuth();
  const { trackingId } = useParams<{ trackingId: string }>();
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [events, setEvents] = useState<ShipmentEvent[]>([]);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [drivers, setDrivers] = useState<User[]>([]);
  const [newStatus, setNewStatus] = useState<ShipmentStatus | "">("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [recipientDni, setRecipientDni] = useState("");
  const [senderDni, setSenderDni] = useState("");
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [draftForm, setDraftForm] = useState<SaveDraftPayload | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [saveDraftError, setSaveDraftError] = useState("");
  const [comments, setComments] = useState<ShipmentComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [addingComment, setAddingComment] = useState(false);
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [correctionForm, setCorrectionForm] = useState<Record<string, string>>({});
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [correctionError, setCorrectionError] = useState("");
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const reload = async () => {
    if (!trackingId) return;
    try {
      const [s, ev, cmts] = await Promise.all([
        shipmentApi.get(trackingId),
        shipmentApi.getEvents(trackingId),
        shipmentApi.getComments(trackingId),
      ]);
      setShipment(s);
      setEvents(ev ?? []);
      setComments(cmts ?? []);
      setNewStatus("");
      if (s.status === "pending") {
        setDraftForm({
          sender: { ...s.sender },
          recipient: { ...s.recipient },
          weight_kg: s.weight_kg ?? 0,
          package_type: s.package_type ?? "box",
          is_fragile: s.is_fragile ?? false,
          special_instructions: s.special_instructions ?? "",
        });
      }
    } catch {
      setError("Shipment not found.");
    }
  };

  useEffect(() => {
    reload();
    branchApi.list().then(setBranches);
    if (hasRole("supervisor", "admin", "operator")) {
      usersApi.listDrivers().then(setDrivers);
    }
  }, [trackingId]);

  const handleSaveDraftChanges = async () => {
    if (!trackingId || !draftForm) return;
    if (draftForm.sender.dni && draftForm.sender.dni.length < 7) { setSaveDraftError("Sender DNI must be at least 7 digits."); return; }
    if (draftForm.recipient.dni && draftForm.recipient.dni.length < 7) { setSaveDraftError("Recipient DNI must be at least 7 digits."); return; }
    setSavingDraft(true);
    setSaveDraftError("");
    try {
      await shipmentApi.updateDraft(trackingId, draftForm);
      navigate("/?status=pending");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSaveDraftError(msg ?? "Failed to save changes.");
    } finally {
      setSavingDraft(false);
    }
  };

  const handleConfirmDraft = async () => {
    if (!trackingId) return;
    setConfirming(true);
    setConfirmError("");
    try {
      const confirmed = await shipmentApi.confirmDraft(trackingId, user!.username);
      navigate(`/shipments/${confirmed.tracking_id}`, { replace: true });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setConfirmError(msg ?? "Failed to confirm shipment.");
    } finally {
      setConfirming(false);
    }
  };

  const handleUpdateStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStatus || !trackingId) return;
    setUpdating(true);
    setUpdateError("");
    try {
      await shipmentApi.updateStatus(trackingId, {
        status: newStatus,
        location,
        notes,
        driver_id: newStatus === "delivering" ? selectedDriverId : undefined,
        recipient_dni: newStatus === "delivered" ? recipientDni : undefined,
        sender_dni: newStatus === "returned" ? senderDni : undefined,
      });
      setLocation(""); setNotes(""); setSelectedDriverId(""); setRecipientDni(""); setSenderDni("");
      await reload();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setUpdateError(msg ?? "Failed to update status.");
    } finally {
      setUpdating(false);
    }
  };

  const openCorrectionModal = () => {
    if (!shipment) return;
    const c = shipment.corrections ?? {};
    setCorrectionForm({
      sender_name: c.sender_name ?? shipment.sender.name ?? "",
      sender_phone: c.sender_phone ?? shipment.sender.phone ?? "",
      sender_email: c.sender_email ?? shipment.sender.email ?? "",
      sender_dni: c.sender_dni ?? shipment.sender.dni ?? "",
      origin_street: c.origin_street ?? shipment.sender.address?.street ?? "",
      origin_city: c.origin_city ?? shipment.sender.address?.city ?? "",
      origin_province: c.origin_province ?? shipment.sender.address?.province ?? "",
      origin_postal_code: c.origin_postal_code ?? shipment.sender.address?.postal_code ?? "",
      recipient_name: c.recipient_name ?? shipment.recipient.name ?? "",
      recipient_phone: c.recipient_phone ?? shipment.recipient.phone ?? "",
      recipient_email: c.recipient_email ?? shipment.recipient.email ?? "",
      recipient_dni: c.recipient_dni ?? shipment.recipient.dni ?? "",
      destination_street: c.destination_street ?? shipment.recipient.address?.street ?? "",
      destination_city: c.destination_city ?? shipment.recipient.address?.city ?? "",
      destination_province: c.destination_province ?? shipment.recipient.address?.province ?? "",
      destination_postal_code: c.destination_postal_code ?? shipment.recipient.address?.postal_code ?? "",
      weight_kg: c.weight_kg ?? String(shipment.weight_kg ?? ""),
      package_type: c.package_type ?? shipment.package_type ?? "",
      special_instructions: c.special_instructions ?? shipment.special_instructions ?? "",
    });
    setCorrectionError("");
    setShowCorrectionModal(true);
  };

  const handleSaveCorrection = async () => {
    if (!trackingId || !shipment) return;
    // Only send fields that differ from effective current value
    const c = shipment.corrections ?? {};
    const effective: Record<string, string> = {
      sender_name: c.sender_name ?? shipment.sender.name ?? "",
      sender_phone: c.sender_phone ?? shipment.sender.phone ?? "",
      sender_email: c.sender_email ?? shipment.sender.email ?? "",
      sender_dni: c.sender_dni ?? shipment.sender.dni ?? "",
      origin_street: c.origin_street ?? shipment.sender.address?.street ?? "",
      origin_city: c.origin_city ?? shipment.sender.address?.city ?? "",
      origin_province: c.origin_province ?? shipment.sender.address?.province ?? "",
      origin_postal_code: c.origin_postal_code ?? shipment.sender.address?.postal_code ?? "",
      recipient_name: c.recipient_name ?? shipment.recipient.name ?? "",
      recipient_phone: c.recipient_phone ?? shipment.recipient.phone ?? "",
      recipient_email: c.recipient_email ?? shipment.recipient.email ?? "",
      recipient_dni: c.recipient_dni ?? shipment.recipient.dni ?? "",
      destination_street: c.destination_street ?? shipment.recipient.address?.street ?? "",
      destination_city: c.destination_city ?? shipment.recipient.address?.city ?? "",
      destination_province: c.destination_province ?? shipment.recipient.address?.province ?? "",
      destination_postal_code: c.destination_postal_code ?? shipment.recipient.address?.postal_code ?? "",
      weight_kg: c.weight_kg ?? String(shipment.weight_kg ?? ""),
      package_type: c.package_type ?? shipment.package_type ?? "",
      special_instructions: c.special_instructions ?? shipment.special_instructions ?? "",
    };
    const changed: Record<string, string> = {};
    for (const key of Object.keys(correctionForm)) {
      if (correctionForm[key] !== effective[key]) {
        changed[key] = correctionForm[key];
      }
    }
    if (Object.keys(changed).length === 0) {
      setShowCorrectionModal(false);
      return;
    }
    if (changed.sender_dni !== undefined && changed.sender_dni.length < 7) { setCorrectionError("Sender DNI must be at least 7 digits."); return; }
    if (changed.recipient_dni !== undefined && changed.recipient_dni.length < 7) { setCorrectionError("Recipient DNI must be at least 7 digits."); return; }
    setSavingCorrection(true);
    setCorrectionError("");
    try {
      await shipmentApi.correctShipment(trackingId, changed);
      setShowCorrectionModal(false);
      await reload();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setCorrectionError(msg ?? "Failed to save corrections.");
    } finally {
      setSavingCorrection(false);
    }
  };

  const handleCancel = async () => {
    if (!trackingId) return;
    setCancelling(true);
    setCancelError("");
    try {
      await shipmentApi.cancelShipment(trackingId, cancelReason);
      setShowCancelModal(false);
      setCancelReason("");
      await reload();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setCancelError(msg ?? "Failed to cancel shipment.");
    } finally {
      setCancelling(false);
    }
  };

  if (error) return (
    <div style={{ padding: 24 }}>
      <p style={{ color: "#ef4444" }}>{error}</p>
      <button onClick={() => navigate("/")} style={backBtn}>← Back to list</button>
    </div>
  );

  if (!shipment) return <div style={{ padding: 24 }}>Loading...</div>;

  const isAtOriginBranch = shipment.current_location === shipment.receiving_branch_id;
  const nextStatuses = TRANSITIONS[shipment.status].filter(
    (s) => s !== "ready_for_return" || isAtOriginBranch
  ).filter(
    (s) => !hasRole("operator") || shipment.status !== "delivering" || s !== "delivered"
  );
  const fmt = fmtDateTime;
  const fmtAddr = (a: { street?: string; city: string; province: string; postal_code?: string }) =>
    [a.street, a.city, a.province, a.postal_code].filter(Boolean).join(", ");

  return (
    <div style={{ padding: "24px 32px" }}>
      <button onClick={() => navigate("/")} style={backBtn}>← Back to list</button>

      <div style={{ display: "grid", gridTemplateColumns: "720px 300px", gap: 32, alignItems: "start", marginTop: 16, justifyContent: "center" }}>

      {/* ── Left column ── */}
      <div>
      <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>
          <code style={{ fontSize: 22 }}>{shipment.tracking_id}</code>
        </h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {hasRole("supervisor", "admin") && shipment.status !== "pending" && shipment.status !== "delivered" && shipment.status !== "returned" && shipment.status !== "cancelled" && (
            <button onClick={openCorrectionModal} style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#374151" }}>
              ✏️ Edit data
            </button>
          )}
          {hasRole("supervisor", "admin") && shipment.status !== "pending" && shipment.status !== "delivered" && shipment.status !== "returned" && shipment.status !== "cancelled" && (
            <button onClick={() => { setCancelReason(""); setCancelError(""); setShowCancelModal(true); }}
              style={{ background: "#fff", border: "1px solid #fca5a5", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#b91c1c" }}>
              Cancel shipment
            </button>
          )}
          <StatusBadge status={shipment.status} />
        </div>
      </div>
      {shipment.status === "pending" && draftForm ? (
        /* ── Draft edit form ── */
        <DraftEditForm
          form={draftForm}
          onChange={setDraftForm}
          onSave={handleSaveDraftChanges}
          onConfirm={handleConfirmDraft}
          saving={savingDraft}
          confirming={confirming}
          saveError={saveDraftError}
          confirmError={confirmError}
          createdAt={fmt(shipment.created_at)}
        />
      ) : (
        /* ── Read-only info grid ── */
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            {(() => {
              const cor = shipment.corrections ?? {};
              const cv = (key: string, original: string) =>
                cor[key] ? { value: cor[key], original, corrected: true } : { value: original, original, corrected: false };
              const originParts = [
                cor.origin_street ?? shipment.sender.address?.street,
                cor.origin_city ?? shipment.sender.address?.city,
                cor.origin_province ?? shipment.sender.address?.province,
                cor.origin_postal_code ?? shipment.sender.address?.postal_code,
              ].filter(Boolean).join(", ");
              const originCorrected = !!(cor.origin_street || cor.origin_city || cor.origin_province || cor.origin_postal_code);
              const originalOrigin = fmtAddr(shipment.sender.address);
              const destParts = [
                cor.destination_street ?? shipment.recipient.address?.street,
                cor.destination_city ?? shipment.recipient.address?.city,
                cor.destination_province ?? shipment.recipient.address?.province,
                cor.destination_postal_code ?? shipment.recipient.address?.postal_code,
              ].filter(Boolean).join(", ");
              const destCorrected = !!(cor.destination_street || cor.destination_city || cor.destination_province || cor.destination_postal_code);
              const originalDest = fmtAddr(shipment.recipient.address);
              const weightVal = cv("weight_kg", `${shipment.weight_kg} kg`);
              const pkgVal = cv("package_type", PACKAGE_LABELS[shipment.package_type]);
              const instrVal = cv("special_instructions", shipment.special_instructions ?? "");
              return <>
                <Card title="Sender">
                  <InfoRowEx {...cv("sender_name", shipment.sender.name)} label="Name" />
                  <InfoRowEx {...cv("sender_phone", shipment.sender.phone)} label="Phone" />
                  {(shipment.sender.email || cor.sender_email) && <InfoRowEx {...cv("sender_email", shipment.sender.email ?? "")} label="Email" />}
                  {(shipment.sender.dni || cor.sender_dni) && <InfoRowEx {...cv("sender_dni", shipment.sender.dni ?? "")} label="DNI" />}
                  <InfoRowEx value={originParts || originalOrigin} original={originalOrigin} corrected={originCorrected} label="Origin" />
                </Card>
                <Card title="Recipient">
                  <InfoRowEx {...cv("recipient_name", shipment.recipient.name)} label="Name" />
                  <InfoRowEx {...cv("recipient_phone", shipment.recipient.phone)} label="Phone" />
                  {(shipment.recipient.email || cor.recipient_email) && <InfoRowEx {...cv("recipient_email", shipment.recipient.email ?? "")} label="Email" />}
                  {(shipment.recipient.dni || cor.recipient_dni) && <InfoRowEx {...cv("recipient_dni", shipment.recipient.dni ?? "")} label="DNI" />}
                  <InfoRowEx value={destParts || originalDest} original={originalDest} corrected={destCorrected} label="Destination" />
                </Card>
                <Card title="Package">
                  <InfoRowEx {...pkgVal} label="Type" />
                  {shipment.is_fragile && <InfoRow label="Fragile" value="⚠️ Yes" />}
                  <InfoRowEx value={weightVal.corrected ? `${cor.weight_kg} kg` : `${shipment.weight_kg} kg`} original={`${shipment.weight_kg} kg`} corrected={weightVal.corrected} label="Weight" />
                  {(shipment.special_instructions || cor.special_instructions) && <InfoRowEx {...instrVal} label="Instructions" />}
                </Card>
                <Card title="Dates & Location">
                  <InfoRow label="Created"       value={fmt(shipment.created_at)} />
                  <InfoRow label="Est. Delivery"  value={fmt(shipment.estimated_delivery_at)} />
                  {shipment.delivered_at && <InfoRow label="Delivered" value={fmt(shipment.delivered_at)} />}
                  {shipment.current_location && (
                    <InfoRow label="Current location" value={`📍 ${branchLabelById(shipment.current_location, branches)}`} />
                  )}
                </Card>
              </>;
            })()}
          </div>
          <RouteTimeline events={events} origin={shipment.sender.address.city} receivingBranchId={shipment.receiving_branch_id} destination={shipment.recipient.address.city} branches={branches} />
        </>
      )}

      {/* Status update — supervisor and admin only */}
      {nextStatuses.length > 0 && hasRole("supervisor", "admin", "operator") && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <h2 style={{ fontSize: "1rem", margin: "0 0 14px" }}>Update Status</h2>
          <form onSubmit={handleUpdateStatus} style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {nextStatuses.map((s) => (
                <button key={s} type="button" onClick={() => setNewStatus(s)}
                  style={{
                    padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600,
                    border: newStatus === s ? "2px solid #1e3a5f" : "2px solid #e5e7eb",
                    background: newStatus === s ? "#e0eaff" : "#fff",
                    color: newStatus === s ? "#1e3a5f" : "#374151",
                  }}>
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
            {newStatus === "in_transit" && (
              <select value={location} onChange={(e) => setLocation(e.target.value)}
                required style={inputStyle}>
                <option value="">Select destination branch (required)</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.city}>{b.name}</option>
                ))}
              </select>
            )}
            {newStatus === "at_branch" && shipment.status === "in_transit" && (() => {
              const arrivalLocation = [...events].reverse().find(ev => ev.to_status === "in_transit")?.location;
              return arrivalLocation ? (
                <p style={{ margin: 0, fontSize: 13, color: "#4b5563" }}>
                  Arriving at: <strong>{branchLabel(arrivalLocation, branches)}</strong>
                </p>
              ) : null;
            })()}
            {newStatus === "delivering" && (
              <select
                value={selectedDriverId}
                onChange={(e) => setSelectedDriverId(e.target.value)}
                required
                style={inputStyle}
              >
                <option value="">Select driver (required)</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>{d.username}</option>
                ))}
              </select>
            )}
            {newStatus === "delivered" && (
              <input
                value={recipientDni}
                onChange={(e) => setRecipientDni(e.target.value)}
                placeholder="Recipient DNI (required)"
                required
                style={inputStyle}
              />
            )}
            {newStatus === "returned" && (
              <input
                value={senderDni}
                onChange={(e) => setSenderDni(e.target.value)}
                placeholder="Sender DNI (required)"
                required
                style={inputStyle}
              />
            )}
            {newStatus === "at_branch" && shipment.status === "delivery_failed" && (() => {
              const returnLocation = [...events].reverse().find(ev => ev.to_status === "at_branch")?.location;
              return returnLocation ? (
                <p style={{ margin: 0, fontSize: 13, color: "#4b5563" }}>
                  Returning to: <strong>{branchLabel(returnLocation, branches)}</strong>
                </p>
              ) : null;
            })()}
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder={newStatus === "delivery_failed" ? "Reason required (e.g. Recipient not home)" : "Notes (optional)"}
              required={newStatus === "delivery_failed"}
              style={inputStyle} />
            {newStatus === "delivery_failed" && !notes.trim() && (
              <p style={{ margin: 0, fontSize: 12, color: "#dc2626" }}>A reason is required for a failed delivery attempt.</p>
            )}
            {newStatus === "delivered" && !recipientDni.trim() && (
              <p style={{ margin: 0, fontSize: 12, color: "#dc2626" }}>Recipient DNI is required to mark as delivered.</p>
            )}
            {newStatus === "returned" && !senderDni.trim() && (
              <p style={{ margin: 0, fontSize: 12, color: "#dc2626" }}>Sender DNI is required to register the return.</p>
            )}
            {updateError && <p style={{ color: "#ef4444", margin: 0, fontSize: 13 }}>{updateError}</p>}
            <button type="submit"
              disabled={
                !newStatus || updating ||
                (newStatus === "delivery_failed" && !notes.trim()) ||
                (newStatus === "delivering" && !selectedDriverId) ||
                (newStatus === "delivered" && !recipientDni.trim()) ||
                (newStatus === "returned" && !senderDni.trim())
              }
              style={{
                background: (newStatus && !updating && !(newStatus === "delivery_failed" && !notes.trim()) && !(newStatus === "delivering" && !selectedDriverId) && !(newStatus === "delivered" && !recipientDni.trim()) && !(newStatus === "returned" && !senderDni.trim())) ? "#1e3a5f" : "#e5e7eb",
                color: (newStatus && !updating && !(newStatus === "delivery_failed" && !notes.trim()) && !(newStatus === "delivering" && !selectedDriverId) && !(newStatus === "delivered" && !recipientDni.trim()) && !(newStatus === "returned" && !senderDni.trim())) ? "#fff" : "#9ca3af",
                border: "none", borderRadius: 6, padding: "8px 16px",
                cursor: (newStatus && !updating && !(newStatus === "delivery_failed" && !notes.trim()) && !(newStatus === "delivering" && !selectedDriverId) && !(newStatus === "delivered" && !recipientDni.trim()) && !(newStatus === "returned" && !senderDni.trim())) ? "pointer" : "default",
                fontWeight: 600, alignSelf: "start",
              }}>
              {updating ? "Updating..." : "Confirm Update"}
            </button>
          </form>
        </div>
      )}

      {shipment.status === "delivered" && (
        <div style={{ ...cardStyle, marginBottom: 16, background: "#d1fae5", border: "1px solid #6ee7b7" }}>
          <p style={{ margin: 0, color: "#065f46", fontWeight: 600 }}>This shipment has been delivered.</p>
        </div>
      )}

      {/* Event history */}
      <h2 style={{ fontSize: "1rem", marginBottom: 12 }}>Event History</h2>
      {events.length === 0 ? (
        <p style={{ color: "#6b7280", fontSize: 14 }}>No events recorded.</p>
      ) : (
        <div style={{ position: "relative", paddingLeft: 24 }}>
          <div style={{ position: "absolute", left: 7, top: 8, bottom: 8, width: 2, background: "#e5e7eb" }} />
          {[...events].reverse().map((ev) => (
            <div key={ev.id} style={{ position: "relative", marginBottom: 12 }}>
              <div style={{
                position: "absolute", left: -24, top: 4,
                width: 14, height: 14, borderRadius: "50%",
                background: "#1e3a5f", border: "2px solid #fff", boxShadow: "0 0 0 2px #e5e7eb",
              }} />
              <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <span style={{ fontWeight: 600 }}>
                    {ev.event_type === "edited"
                      ? STATUS_LABELS[ev.to_status]
                      : ev.from_status
                        ? `${STATUS_LABELS[ev.from_status]} → ${STATUS_LABELS[ev.to_status]}`
                        : STATUS_LABELS[ev.to_status]}
                  </span>
                  <span style={{ color: "#9ca3af" }}>{fmt(ev.timestamp)}</span>
                </div>
                <div style={{ color: "#6b7280", display: "flex", gap: 16, flexWrap: "wrap" as const }}>
                  <span>by <strong>{ev.changed_by || "system"}</strong></span>
                  {ev.location && (() => {
                    const b = branches.find(x => x.id === ev.location);
                    return (
                      <span>📍 <strong>{b?.name ?? ev.location}</strong>{b && <> · {b.city} · <span style={{ color: "#9ca3af" }}>{b.province}</span></>}</span>
                    );
                  })()}
                </div>
                {ev.notes && <p style={{ margin: "4px 0 0", color: "#4b5563" }}>{ev.notes}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>{/* end maxWidth wrapper */}
      </div>{/* end left column */}

      {/* ── Right column: Comments ── */}
      <div style={{ position: "sticky", top: 24 }}>
        <div style={{ ...cardStyle }}>
          <h2 style={{ fontSize: "1rem", margin: "0 0 12px" }}>Comments</h2>
          {hasRole("supervisor", "admin", "operator") && shipment.status !== "delivered" && shipment.status !== "returned" && (
            <div style={{ marginBottom: 12 }}>
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                rows={2}
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const, resize: "vertical" as const, fontFamily: "inherit" }}
              />
              <button
                disabled={addingComment || !newComment.trim()}
                onClick={async () => {
                  if (!trackingId || !newComment.trim()) return;
                  setAddingComment(true);
                  try {
                    await shipmentApi.addComment(trackingId, newComment.trim());
                    setNewComment("");
                    const cmts = await shipmentApi.getComments(trackingId);
                    setComments(cmts);
                  } finally {
                    setAddingComment(false);
                  }
                }}
                style={{ marginTop: 6, background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontWeight: 600, fontSize: 13 }}
              >
                {addingComment ? "Adding..." : "Add comment"}
              </button>
            </div>
          )}
          {comments.length === 0 ? (
            <p style={{ color: "#6b7280", fontSize: 13, margin: 0 }}>No comments yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 8, maxHeight: 500, overflowY: "auto" }}>
              {comments.map((c) => (
                <div key={c.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>{c.author}</span>
                    <span style={{ color: "#9ca3af", fontSize: 12 }}>{fmtDateTime(c.created_at)}</span>
                  </div>
                  <p style={{ margin: 0, color: "#374151", whiteSpace: "pre-wrap" as const }}>{c.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      </div>{/* end two-column grid */}

      {showCorrectionModal && shipment && (
        <CorrectionModal
          form={correctionForm}
          onChange={setCorrectionForm}
          onSave={handleSaveCorrection}
          onClose={() => setShowCorrectionModal(false)}
          saving={savingCorrection}
          error={correctionError}
        />
      )}

      {showCancelModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: "28px 32px", width: 440, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 18, color: "#b91c1c" }}>Cancel shipment</h2>
            <p style={{ margin: "0 0 20px", fontSize: 14, color: "#6b7280" }}>
              This action is irreversible. The shipment will move to <strong>Cancelled</strong> and cannot continue transit.
            </p>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
              Cancellation reason *
            </label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Describe the reason for cancellation..."
              rows={4}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, boxSizing: "border-box", resize: "vertical" }}
            />
            {cancelError && <p style={{ color: "#ef4444", fontSize: 13, margin: "8px 0 0" }}>{cancelError}</p>}
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setShowCancelModal(false)} disabled={cancelling}
                style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 18px", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#374151" }}>
                Back
              </button>
              <button type="button" onClick={handleCancel} disabled={cancelling || !cancelReason.trim()}
                style={{ background: cancelReason.trim() ? "#b91c1c" : "#fca5a5", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", cursor: cancelReason.trim() ? "pointer" : "not-allowed", fontSize: 14, fontWeight: 700 }}>
                {cancelling ? "Cancelling..." : "Confirm cancellation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const PROVINCES = [
  "Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes",
  "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza",
  "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis",
  "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán",
];
const PACKAGE_TYPES = [
  { value: "envelope", label: "Envelope" },
  { value: "box",      label: "Box" },
  { value: "pallet",   label: "Pallet" },
];

function CustomerSuggestion({ customer, onApply, onDismiss }: { customer: Customer; onApply: () => void; onDismiss: () => void }) {
  return (
    <div style={{
      position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50,
      border: "1px solid #bfdbfe", background: "#eff6ff", borderRadius: 8,
      padding: "10px 12px", display: "flex", justifyContent: "space-between",
      alignItems: "center", gap: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
    }}>
      <div style={{ fontSize: 13, color: "#1e40af", lineHeight: 1.5, minWidth: 0 }}>
        <span style={{ fontWeight: 700 }}>{customer.name}</span>
        <span style={{ color: "#6b7280", margin: "0 6px" }}>·</span>
        <span>{customer.phone}</span>
        {customer.address.city && (
          <>
            <span style={{ color: "#6b7280", margin: "0 6px" }}>·</span>
            <span>{customer.address.city}, {customer.address.province}</span>
          </>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button type="button" onClick={onApply}
          style={{ background: "#1e40af", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
          Usar datos
        </button>
        <button type="button" onClick={onDismiss}
          style={{ background: "none", color: "#6b7280", border: "1px solid #d1d5db", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 12 }}>
          ✕
        </button>
      </div>
    </div>
  );
}

function DraftEditForm({ form, onChange, onSave, onConfirm, saving, confirming, saveError, confirmError, createdAt }: {
  form: SaveDraftPayload;
  onChange: (f: SaveDraftPayload) => void;
  onSave: () => void;
  onConfirm: () => void;
  saving: boolean;
  confirming: boolean;
  saveError: string;
  confirmError: string;
  createdAt: string;
}) {
  const set = (field: string, value: unknown) => onChange({ ...form, [field]: value });
  const setSender = (field: string, value: unknown) =>
    onChange({ ...form, sender: { ...form.sender, [field]: value } });
  const setSenderAddr = (field: string, value: string) =>
    onChange({ ...form, sender: { ...form.sender, address: { ...form.sender.address, [field]: value } } });
  const setRecipient = (field: string, value: unknown) =>
    onChange({ ...form, recipient: { ...form.recipient, [field]: value } });
  const setRecipientAddr = (field: string, value: string) =>
    onChange({ ...form, recipient: { ...form.recipient, address: { ...form.recipient.address, [field]: value } } });

  const [senderSuggestion, setSenderSuggestion] = useState<Customer | null>(null);
  const [recipientSuggestion, setRecipientSuggestion] = useState<Customer | null>(null);
  const senderDNITimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recipientDNITimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSenderDNI = (dni: string) => {
    setSender("dni", dni);
    setSenderSuggestion(null);
    if (senderDNITimer.current) clearTimeout(senderDNITimer.current);
    if (dni.length >= 7) {
      senderDNITimer.current = setTimeout(async () => {
        const customer = await customerApi.getByDNI(dni);
        if (customer) setSenderSuggestion(customer);
      }, 400);
    }
  };

  const applySenderSuggestion = () => {
    if (!senderSuggestion) return;
    onChange({
      ...form,
      sender: {
        ...form.sender,
        name: senderSuggestion.name,
        phone: senderSuggestion.phone,
        email: senderSuggestion.email ?? form.sender.email,
        address: {
          street: senderSuggestion.address.street ?? form.sender.address.street,
          city: senderSuggestion.address.city || form.sender.address.city,
          province: senderSuggestion.address.province || form.sender.address.province,
          postal_code: senderSuggestion.address.postal_code ?? form.sender.address.postal_code,
        },
      },
    });
    setSenderSuggestion(null);
  };

  const handleRecipientDNI = (dni: string) => {
    setRecipient("dni", dni);
    setRecipientSuggestion(null);
    if (recipientDNITimer.current) clearTimeout(recipientDNITimer.current);
    if (dni.length >= 7) {
      recipientDNITimer.current = setTimeout(async () => {
        const customer = await customerApi.getByDNI(dni);
        if (customer) setRecipientSuggestion(customer);
      }, 400);
    }
  };

  const applyRecipientSuggestion = () => {
    if (!recipientSuggestion) return;
    onChange({
      ...form,
      recipient: {
        ...form.recipient,
        name: recipientSuggestion.name,
        phone: recipientSuggestion.phone,
        email: recipientSuggestion.email ?? form.recipient.email,
        address: {
          street: recipientSuggestion.address.street ?? form.recipient.address.street,
          city: recipientSuggestion.address.city || form.recipient.address.city,
          province: recipientSuggestion.address.province || form.recipient.address.province,
          postal_code: recipientSuggestion.address.postal_code ?? form.recipient.address.postal_code,
        },
      },
    });
    setRecipientSuggestion(null);
  };

  return (
    <div style={{ display: "grid", gap: 16, marginBottom: 16 }}>
      <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Created: {createdAt}</p>

      {/* Sender */}
      <fieldset style={fsStyle}>
        <legend style={legStyle}>Sender</legend>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <DField label="Name"><input style={inp} value={form.sender.name ?? ""} onChange={(e) => setSender("name", e.target.value)} placeholder="Carlos Mendez" /></DField>
          <DField label="Phone"><input style={inp} value={form.sender.phone ?? ""} onChange={(e) => setSender("phone", e.target.value)} placeholder="+54 9 11 1234-5678" /></DField>
          <DField label="Email"><input style={inp} type="email" value={form.sender.email ?? ""} onChange={(e) => setSender("email", e.target.value)} placeholder="optional" /></DField>
          <DField label="DNI">
            <input style={inp} value={form.sender.dni ?? ""} onChange={(e) => handleSenderDNI(e.target.value)} placeholder="e.g. 30123456" />
            {senderSuggestion && <CustomerSuggestion customer={senderSuggestion} onApply={applySenderSuggestion} onDismiss={() => setSenderSuggestion(null)} />}
          </DField>
          <DField label="Street"><input style={inp} value={form.sender.address.street ?? ""} onChange={(e) => setSenderAddr("street", e.target.value)} placeholder="Av. Corrientes 1234" /></DField>
          <DField label="City *"><input style={inp} value={form.sender.address.city ?? ""} onChange={(e) => setSenderAddr("city", e.target.value)} placeholder="Buenos Aires" /></DField>
          <DField label="Province *">
            <select style={inp} value={form.sender.address.province ?? ""} onChange={(e) => setSenderAddr("province", e.target.value)}>
              <option value="">Select</option>
              {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </DField>
          <DField label="Postal code"><input style={inp} value={form.sender.address.postal_code ?? ""} onChange={(e) => setSenderAddr("postal_code", e.target.value)} placeholder="C1043" /></DField>
        </div>
      </fieldset>

      {/* Recipient */}
      <fieldset style={fsStyle}>
        <legend style={legStyle}>Recipient</legend>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <DField label="Name"><input style={inp} value={form.recipient.name ?? ""} onChange={(e) => setRecipient("name", e.target.value)} placeholder="Laura Gomez" /></DField>
          <DField label="Phone"><input style={inp} value={form.recipient.phone ?? ""} onChange={(e) => setRecipient("phone", e.target.value)} placeholder="+54 9 351 678-4321" /></DField>
          <DField label="Email"><input style={inp} type="email" value={form.recipient.email ?? ""} onChange={(e) => setRecipient("email", e.target.value)} placeholder="optional" /></DField>
          <DField label="DNI">
            <input style={inp} value={form.recipient.dni ?? ""} onChange={(e) => handleRecipientDNI(e.target.value)} placeholder="e.g. 28456789" />
            {recipientSuggestion && <CustomerSuggestion customer={recipientSuggestion} onApply={applyRecipientSuggestion} onDismiss={() => setRecipientSuggestion(null)} />}
          </DField>
          <DField label="Street"><input style={inp} value={form.recipient.address.street ?? ""} onChange={(e) => setRecipientAddr("street", e.target.value)} placeholder="San Martín 456" /></DField>
          <DField label="City *"><input style={inp} value={form.recipient.address.city ?? ""} onChange={(e) => setRecipientAddr("city", e.target.value)} placeholder="Córdoba" /></DField>
          <DField label="Province *">
            <select style={inp} value={form.recipient.address.province ?? ""} onChange={(e) => setRecipientAddr("province", e.target.value)}>
              <option value="">Select</option>
              {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </DField>
          <DField label="Postal code"><input style={inp} value={form.recipient.address.postal_code ?? ""} onChange={(e) => setRecipientAddr("postal_code", e.target.value)} placeholder="X5000" /></DField>
        </div>
      </fieldset>

      {/* Package */}
      <fieldset style={fsStyle}>
        <legend style={legStyle}>Package</legend>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <DField label="Weight (kg) *">
            <input style={inp} type="number" step="0.1" min="0" value={form.weight_kg || ""} onChange={(e) => set("weight_kg", parseFloat(e.target.value) || 0)} placeholder="3.5" />
          </DField>
          <DField label="Package type *">
            <select style={inp} value={form.package_type ?? "box"} onChange={(e) => set("package_type", e.target.value)}>
              {PACKAGE_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </DField>
          <DField label="" style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
              <input type="checkbox" checked={!!form.is_fragile} onChange={(e) => set("is_fragile", e.target.checked)} />
              Fragile contents (handle with care)
            </label>
          </DField>
          <DField label="Special instructions" style={{ gridColumn: "1 / -1" }}>
            <input style={inp} value={form.special_instructions ?? ""} onChange={(e) => set("special_instructions", e.target.value)} placeholder='e.g. "Keep upright"' />
          </DField>
        </div>
      </fieldset>

      {/* Actions */}
      <div style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 10, padding: "14px 18px" }}>
        <h2 style={{ fontSize: "1rem", margin: "0 0 8px", color: "#92400e" }}>Draft — pending confirmation</h2>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "#78350f" }}>
          Save changes before confirming. On confirmation a tracking ID will be assigned and the shipment will enter the logistics system.
        </p>
        {saveError && <p style={{ color: "#ef4444", margin: "0 0 8px", fontSize: 13 }}>{saveError}</p>}
        {confirmError && <p style={{ color: "#ef4444", margin: "0 0 8px", fontSize: 13 }}>{confirmError}</p>}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onSave} disabled={saving || confirming}
            style={{ background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 18px", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
            {saving ? "Saving..." : "Save changes"}
          </button>
          <button onClick={onConfirm} disabled={saving || confirming}
            style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "8px 20px", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
            {confirming ? "Confirming..." : "Confirm shipment"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DField({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: "grid", gap: 4, position: "relative", ...style }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>{label}</label>
      {children}
    </div>
  );
}

const fsStyle: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px 18px" };
const legStyle: React.CSSProperties = { fontWeight: 700, fontSize: 13, color: "#1e3a5f", padding: "0 6px" };
const inp: React.CSSProperties = { padding: "7px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13, width: "100%", boxSizing: "border-box" };

function RouteTimeline({ events, origin, receivingBranchId, destination, branches }: {
  events: ShipmentEvent[];
  origin: string;
  receivingBranchId?: string;
  destination: string;
  branches: Branch[];
}) {
  if (events.length === 0) return null;

  const receivingBranch = receivingBranchId ? branches.find((b) => b.id === receivingBranchId) : undefined;
  const firstStop = receivingBranch ? receivingBranch.id : origin;

  // Confirmed stops: receiving branch (or origin fallback) + each at_branch arrival
  const stops: { location: string; status: ShipmentStatus; timestamp: string; current: boolean }[] = [];

  stops.push({ location: firstStop, status: "in_progress" as ShipmentStatus, timestamp: events[0].timestamp, current: false });

  for (const ev of events) {
    if (ev.to_status === "at_branch" && ev.location) {
      stops.push({ location: ev.location, status: ev.to_status, timestamp: ev.timestamp, current: false });
    }
  }

  stops[stops.length - 1].current = true;

  const lastEvent = events[events.length - 1];
  const isInTransit = lastEvent?.to_status === "in_transit";
  const nextBranch = isInTransit ? lastEvent.location : null;
  const isDelivering = lastEvent?.to_status === "delivering";
  const isDelivered = lastEvent?.to_status === "delivered";

  const statusColors: Record<ShipmentStatus, string> = {
    pending: "#9ca3af", in_progress: "#f59e0b", in_transit: "#3b82f6", at_branch: "#8b5cf6", delivering: "#f97316", delivery_failed: "#ef4444", delivered: "#10b981", ready_for_pickup: "#0891b2", ready_for_return: "#7c3aed", returned: "#6b7280", cancelled: "#b91c1c",
  };

  const solidLine = (color = "#e5e7eb") => (
    <div style={{ width: 40, height: 2, background: color, flexShrink: 0, margin: "0 4px", marginBottom: 24 }} />
  );
  const dashedLine = () => (
    <div style={{ width: 40, height: 2, background: "repeating-linear-gradient(to right, #d1d5db 0, #d1d5db 5px, transparent 5px, transparent 9px)", flexShrink: 0, margin: "0 4px", marginBottom: 24 }} />
  );

  return (
    <div style={{ ...cardStyle, marginBottom: 16 }}>
      <h3 style={{ margin: "0 0 16px", fontSize: 13, color: "#1e3a5f", textTransform: "uppercase" as const, letterSpacing: 0.5 }}>
        Route · {origin} → {destination}
      </h3>
      <div style={{ display: "flex", alignItems: "center", gap: 0, overflowX: "auto", paddingBottom: 4 }}>
        {stops.map((stop, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 4 }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                background: stop.current ? statusColors[stop.status] : "#e5e7eb",
                border: stop.current ? `3px solid ${statusColors[stop.status]}` : "3px solid #e5e7eb",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: stop.current ? `0 0 0 3px ${statusColors[stop.status]}33` : "none",
              }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: stop.current ? "#fff" : "#9ca3af" }}>{i + 1}</span>
              </div>
              <div style={{ textAlign: "center" as const, maxWidth: 80 }}>
                {(() => {
                  const b = branches.find(x => x.id === stop.location);
                  return (
                    <div style={{ fontSize: 11, fontWeight: stop.current ? 700 : 500, color: stop.current ? "#1e3a5f" : "#6b7280", whiteSpace: "nowrap" as const }}>{b?.name ?? stop.location}</div>
                  );
                })()}
                <div style={{ fontSize: 10, color: "#9ca3af" }}>{fmtDate(stop.timestamp)}</div>
              </div>
            </div>
            {i < stops.length - 1 && solidLine()}
          </div>
        ))}

        {/* Delivering: dashed line to Recipient node */}
        {isDelivering && (
          <>
            {dashedLine()}
            <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 4, flexShrink: 0 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#f9fafb", border: "3px dashed #f97316", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 14, color: "#f97316" }}>🚚</span>
              </div>
              <div style={{ fontSize: 11, color: "#f97316", fontWeight: 600, whiteSpace: "nowrap" as const }}>Recipient</div>
            </div>
          </>
        )}

        {/* In transit: dashed line to uncolored next branch */}
        {isInTransit && nextBranch && (
          <>
            {dashedLine()}
            <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 4, flexShrink: 0 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#f9fafb", border: "3px dashed #d1d5db", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#d1d5db" }}>{stops.length + 1}</span>
              </div>
              <div style={{ textAlign: "center" as const, maxWidth: 80 }}>
                {(() => {
                  const b = branches.find(x => x.id === nextBranch);
                  return (
                    <div style={{ fontSize: 11, color: "#9ca3af", whiteSpace: "nowrap" as const }}>{b?.name ?? nextBranch}</div>
                  );
                })()}
              </div>
            </div>
          </>
        )}

        {/* Final destination — always shown */}
        <>
          {isDelivered ? solidLine("#10b981") : dashedLine()}
          <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 4, flexShrink: 0 }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              background: isDelivered ? "#10b981" : "#f9fafb",
              border: isDelivered ? "3px solid #10b981" : "3px dashed #d1d5db",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: isDelivered ? "0 0 0 3px #10b98133" : "none",
            }}>
              <span style={{ fontSize: 14, color: isDelivered ? "#fff" : "#d1d5db" }}>
                {isDelivered ? "✓" : "🏁"}
              </span>
            </div>
            <div style={{ fontSize: 11, fontWeight: isDelivered ? 700 : 400, color: isDelivered ? "#065f46" : "#9ca3af", whiteSpace: "nowrap" as const }}>Recipient</div>
          </div>
        </>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={cardStyle}>
      <h3 style={{ margin: "0 0 12px", fontSize: 13, color: "#1e3a5f", textTransform: "uppercase", letterSpacing: 0.5 }}>{title}</h3>
      <div style={{ display: "grid", gap: 6 }}>{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 13 }}>
      <span style={{ color: "#9ca3af", minWidth: 90, flexShrink: 0 }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}

const cardStyle: React.CSSProperties = { background: "#f9fafb", borderRadius: 10, padding: 16 };
const inputStyle: React.CSSProperties = { padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 };
const backBtn: React.CSSProperties = { background: "none", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 14 };

// InfoRowEx: same as InfoRow but supports showing original value when corrected
function InfoRowEx({ label, value, corrected, original }: { label: string; value: string; corrected: boolean; original: string }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 13, alignItems: "flex-start" }}>
      <span style={{ color: "#9ca3af", minWidth: 90, flexShrink: 0 }}>{label}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontWeight: 500 }}>{value}</span>
          {corrected && (
            <span style={{ fontSize: 10, fontWeight: 700, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap" as const }}>
              Modificado
            </span>
          )}
        </div>
        {corrected && original && (
          <span style={{ fontSize: 11, color: "#9ca3af", textDecoration: "line-through" }}>{original}</span>
        )}
      </div>
    </div>
  );
}

function CorrectionModal({ form, onChange, onSave, onClose, saving, error }: {
  form: Record<string, string>;
  onChange: (f: Record<string, string>) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
  error: string;
}) {
  const set = (key: string, value: string) => onChange({ ...form, [key]: value });
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 680, width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem", color: "#1e3a5f" }}>Correct shipment data</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280" }}>✕</button>
        </div>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "#6b7280" }}>
          Original data is not modified. Changes are noted and recorded in the comment history.
        </p>

        {/* Sender */}
        <fieldset style={fsStyle}>
          <legend style={legStyle}>Sender</legend>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <DField label="Name"><input style={inp} value={form.sender_name ?? ""} onChange={(e) => set("sender_name", e.target.value)} /></DField>
            <DField label="Phone"><input style={inp} value={form.sender_phone ?? ""} onChange={(e) => set("sender_phone", e.target.value)} /></DField>
            <DField label="Email"><input style={inp} value={form.sender_email ?? ""} onChange={(e) => set("sender_email", e.target.value)} /></DField>
            <DField label="DNI"><input style={inp} value={form.sender_dni ?? ""} onChange={(e) => set("sender_dni", e.target.value)} /></DField>
            <DField label="Street (origin)"><input style={inp} value={form.origin_street ?? ""} onChange={(e) => set("origin_street", e.target.value)} /></DField>
            <DField label="City (origin)"><input style={inp} value={form.origin_city ?? ""} onChange={(e) => set("origin_city", e.target.value)} /></DField>
            <DField label="Province (origin)">
              <select style={inp} value={form.origin_province ?? ""} onChange={(e) => set("origin_province", e.target.value)}>
                <option value="">Select</option>
                {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </DField>
            <DField label="Postal code (origin)"><input style={inp} value={form.origin_postal_code ?? ""} onChange={(e) => set("origin_postal_code", e.target.value)} /></DField>
          </div>
        </fieldset>

        {/* Recipient */}
        <fieldset style={{ ...fsStyle, marginTop: 12 }}>
          <legend style={legStyle}>Recipient</legend>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <DField label="Name"><input style={inp} value={form.recipient_name ?? ""} onChange={(e) => set("recipient_name", e.target.value)} /></DField>
            <DField label="Phone"><input style={inp} value={form.recipient_phone ?? ""} onChange={(e) => set("recipient_phone", e.target.value)} /></DField>
            <DField label="Email"><input style={inp} value={form.recipient_email ?? ""} onChange={(e) => set("recipient_email", e.target.value)} /></DField>
            <DField label="DNI"><input style={inp} value={form.recipient_dni ?? ""} onChange={(e) => set("recipient_dni", e.target.value)} /></DField>
            <DField label="Street (destination)"><input style={inp} value={form.destination_street ?? ""} onChange={(e) => set("destination_street", e.target.value)} /></DField>
            <DField label="City (destination)"><input style={inp} value={form.destination_city ?? ""} onChange={(e) => set("destination_city", e.target.value)} /></DField>
            <DField label="Province (destination)">
              <select style={inp} value={form.destination_province ?? ""} onChange={(e) => set("destination_province", e.target.value)}>
                <option value="">Select</option>
                {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </DField>
            <DField label="Postal code (destination)"><input style={inp} value={form.destination_postal_code ?? ""} onChange={(e) => set("destination_postal_code", e.target.value)} /></DField>
          </div>
        </fieldset>

        {/* Package */}
        <fieldset style={{ ...fsStyle, marginTop: 12 }}>
          <legend style={legStyle}>Package</legend>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <DField label="Weight (kg)"><input style={inp} type="number" step="0.1" min="0" value={form.weight_kg ?? ""} onChange={(e) => set("weight_kg", e.target.value)} /></DField>
            <DField label="Type">
              <select style={inp} value={form.package_type ?? ""} onChange={(e) => set("package_type", e.target.value)}>
                {PACKAGE_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </DField>
            <DField label="Special instructions" style={{ gridColumn: "1 / -1" }}>
              <input style={inp} value={form.special_instructions ?? ""} onChange={(e) => set("special_instructions", e.target.value)} />
            </DField>
          </div>
        </fieldset>

        {error && <p style={{ color: "#ef4444", fontSize: 13, margin: "12px 0 0" }}>{error}</p>}
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={onClose} disabled={saving} style={{ background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 18px", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
            Cancel
          </button>
          <button onClick={onSave} disabled={saving} style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "8px 20px", cursor: saving ? "default" : "pointer", fontWeight: 700, fontSize: 14 }}>
            {saving ? "Saving..." : "Save corrections"}
          </button>
        </div>
      </div>
    </div>
  );
}
