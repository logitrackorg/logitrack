import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { shipmentApi, type CreateShipmentPayload, type PackageType, type ShipmentType, type TimeWindow, type Shipment } from "../api/shipments";
import { branchApi, type Branch } from "../api/branches";
import { customerApi, type Customer } from "../api/customers";
import { fmtDateTime } from "../utils/date";
import { useIsMobile } from "../hooks/useIsMobile";

const PROVINCES = [
  "Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes",
  "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza",
  "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis",
  "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán",
];

const PACKAGE_TYPES: { value: PackageType; label: string }[] = [
  { value: "envelope", label: "Envelope" },
  { value: "box",      label: "Box" },
  { value: "pallet",   label: "Pallet" },
];

const SHIPMENT_TYPES: { value: ShipmentType; label: string }[] = [
  { value: "normal",  label: "Normal" },
  { value: "express", label: "Express" },
];

const TIME_WINDOWS: { value: TimeWindow; label: string }[] = [
  { value: "flexible",  label: "Flexible" },
  { value: "morning",   label: "Morning (8-12)" },
  { value: "afternoon", label: "Afternoon (12-18)" },
];

const emptyAddress = { street: "", city: "", province: "", postal_code: "" };
const emptyCustomer = () => ({ dni: "", name: "", phone: "", email: "", address: { ...emptyAddress } });

const initialForm: CreateShipmentPayload = {
  sender: emptyCustomer(),
  recipient: emptyCustomer(),
  weight_kg: 0,
  package_type: "box",
  special_instructions: "",
  shipment_type: "normal",
  time_window: "flexible",
  cold_chain: false,
  receiving_branch_id: "",
};

export function NewShipment() {
  const isMobile = useIsMobile();
  const [form, setForm] = useState<CreateShipmentPayload>(initialForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Shipment[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [senderSuggestion, setSenderSuggestion] = useState<Customer | null>(null);
  const [recipientSuggestion, setRecipientSuggestion] = useState<Customer | null>(null);
  const senderDNITimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recipientDNITimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    shipmentApi.list().then((all) => {
      setDrafts(all.filter((s) => s.status === "pending"));
    }).catch(() => {});
    branchApi.listActive().then(setBranches).catch(() => {});
  }, []);

  const set = (field: string, value: unknown) =>
    setForm((prev) => ({ ...prev, [field]: value }));
  const setSender = (field: string, value: unknown) =>
    setForm((prev) => ({ ...prev, sender: { ...prev.sender, [field]: value } }));
  const setSenderAddr = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, sender: { ...prev.sender, address: { ...prev.sender.address, [field]: value } } }));
  const setRecipient = (field: string, value: unknown) =>
    setForm((prev) => ({ ...prev, recipient: { ...prev.recipient, [field]: value } }));
  const setRecipientAddr = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, recipient: { ...prev.recipient, address: { ...prev.recipient.address, [field]: value } } }));

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
    setForm((prev) => ({
      ...prev,
      sender: {
        ...prev.sender,
        name: senderSuggestion.name,
        phone: (senderSuggestion.phone ?? "").replace(/\D/g, ""),
        email: senderSuggestion.email ?? prev.sender.email,
        address: {
          street: senderSuggestion.address.street ?? prev.sender.address.street,
          city: senderSuggestion.address.city || prev.sender.address.city,
          province: senderSuggestion.address.province || prev.sender.address.province,
          postal_code: senderSuggestion.address.postal_code ?? prev.sender.address.postal_code,
        },
      },
    }));
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
    setForm((prev) => ({
      ...prev,
      recipient: {
        ...prev.recipient,
        name: recipientSuggestion.name,
        phone: (recipientSuggestion.phone ?? "").replace(/\D/g, ""),
        email: recipientSuggestion.email ?? prev.recipient.email,
        address: {
          street: recipientSuggestion.address.street ?? prev.recipient.address.street,
          city: recipientSuggestion.address.city || prev.recipient.address.city,
          province: recipientSuggestion.address.province || prev.recipient.address.province,
          postal_code: recipientSuggestion.address.postal_code ?? prev.recipient.address.postal_code,
        },
      },
    }));
    setRecipientSuggestion(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.sender.phone) { setError("Sender phone is required."); return; }
    if (!form.recipient.phone) { setError("Recipient phone is required."); return; }
    if (form.sender.dni.length < 7) { setError("Sender DNI must be at least 7 digits."); return; }
    if (form.recipient.dni.length < 7) { setError("Recipient DNI must be at least 7 digits."); return; }
    if (!form.weight_kg || form.weight_kg <= 0) { setError("Weight must be greater than 0."); return; }
    if (!form.sender.address.street) { setError("Sender street is required."); return; }
    if (!form.recipient.address.street) { setError("Recipient street is required."); return; }
    if (/^\d+$/.test(form.sender.address.city)) { setError("Sender city cannot contain numbers only."); return; }
    if (/^\d+$/.test(form.recipient.address.city)) { setError("Recipient city cannot contain numbers only."); return; }
    if (!form.sender.address.postal_code) { setError("Sender postal code is required."); return; }
    if (/^[a-zA-Z]+$/.test(form.sender.address.postal_code)) { setError("Sender postal code must contain at least one digit."); return; }
    if (!form.recipient.address.postal_code) { setError("Recipient postal code is required."); return; }
    if (/^[a-zA-Z]+$/.test(form.recipient.address.postal_code)) { setError("Recipient postal code must contain at least one digit."); return; }
    setLoading(true);
    setError("");
    try {
      const shipment = await shipmentApi.create(form);
      navigate(`/shipments/${shipment.tracking_id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? "Failed to create shipment. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!form.sender.name) { setError("Sender name is required to save a draft."); return; }
    if (!form.recipient.name) { setError("Recipient name is required to save a draft."); return; }
    setLoading(true);
    setError("");
    try {
      const shipment = await shipmentApi.saveDraft(form);
      navigate(`/shipments/${shipment.tracking_id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? "Failed to save draft. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: isMobile ? 16 : "24px 32px", maxWidth: 720, margin: "0 auto" }}>
      <button onClick={() => navigate("/")} style={backBtn}>← Back to list</button>
      <h1 style={{ marginTop: 16, marginBottom: 24 }}>New Shipment</h1>

      {drafts.length > 0 && (
        <div style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 10, padding: "14px 18px", marginBottom: 24 }}>
          <p style={{ margin: "0 0 10px", fontWeight: 700, fontSize: 14, color: "#92400e" }}>
            Saved drafts ({drafts.length})
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {drafts.map((d) => (
              <div key={d.tracking_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", border: "1px solid #fde68a", borderRadius: 7, padding: "8px 12px" }}>
                <div style={{ fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>{d.sender?.name || "No name"}</span>
                  <span style={{ color: "#9ca3af", margin: "0 6px" }}>→</span>
                  <span>{d.recipient?.name || "No name"}</span>
                  <span style={{ color: "#9ca3af", fontSize: 12, marginLeft: 10 }}>{fmtDateTime(d.created_at)}</span>
                </div>
                <button onClick={() => navigate(`/shipments/${d.tracking_id}`)}
                  style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "5px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
                  Resume
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 24 }}>

        {/* Sender */}
        <Section title="Sender">
          <Row2>
            <Field label="Full Name *">
              <input style={input} required value={form.sender.name}
                onChange={(e) => setSender("name", e.target.value)} placeholder="e.g. Carlos Mendez" />
            </Field>
            <Field label="Phone *">
              <input style={input} required value={form.sender.phone}
                onChange={(e) => setSender("phone", e.target.value.replace(/\D/g, ""))} placeholder="5491112345678" />
            </Field>
          </Row2>
          <Row2>
            <Field label="Email">
              <input style={input} type="email" value={form.sender.email}
                onChange={(e) => setSender("email", e.target.value)} placeholder="optional" />
            </Field>
            <Field label="DNI *">
              <div style={{ position: "relative" }}>
                <input style={input} required value={form.sender.dni}
                  onChange={(e) => handleSenderDNI(e.target.value)} placeholder="Ej: 30123456" />
                {senderSuggestion && (
                  <CustomerSuggestion customer={senderSuggestion} onApply={applySenderSuggestion} onDismiss={() => setSenderSuggestion(null)} />
                )}
              </div>
            </Field>
          </Row2>
          <Row2>
            <Field label="Street *">
              <input style={input} required value={form.sender.address.street}
                onChange={(e) => setSenderAddr("street", e.target.value)} placeholder="Av. Corrientes 1234" />
            </Field>
            <Field label="City *">
              <input style={input} required value={form.sender.address.city}
                onChange={(e) => setSenderAddr("city", e.target.value)} placeholder="Buenos Aires" />
            </Field>
          </Row2>
          <Row2>
            <Field label="Province *">
              <select style={input} required value={form.sender.address.province}
                onChange={(e) => setSenderAddr("province", e.target.value)}>
                <option value="">Select province</option>
                {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Postal Code *">
              <input style={input} required value={form.sender.address.postal_code}
                onChange={(e) => setSenderAddr("postal_code", e.target.value)} placeholder="C1043" />
            </Field>
          </Row2>
        </Section>

        {/* Recipient */}
        <Section title="Recipient">
          <Row2>
            <Field label="Full Name *">
              <input style={input} required value={form.recipient.name}
                onChange={(e) => setRecipient("name", e.target.value)} placeholder="e.g. Laura Gomez" />
            </Field>
            <Field label="Phone *">
              <input style={input} required value={form.recipient.phone}
                onChange={(e) => setRecipient("phone", e.target.value.replace(/\D/g, ""))} placeholder="5493516784321" />
            </Field>
          </Row2>
          <Row2>
            <Field label="Email">
              <input style={input} type="email" value={form.recipient.email}
                onChange={(e) => setRecipient("email", e.target.value)} placeholder="optional" />
            </Field>
            <Field label="DNI *">
              <div style={{ position: "relative" }}>
                <input style={input} required value={form.recipient.dni}
                  onChange={(e) => handleRecipientDNI(e.target.value)} placeholder="Ej: 28456789" />
                {recipientSuggestion && (
                  <CustomerSuggestion customer={recipientSuggestion} onApply={applyRecipientSuggestion} onDismiss={() => setRecipientSuggestion(null)} />
                )}
              </div>
            </Field>
          </Row2>
          <Row2>
            <Field label="Street *">
              <input style={input} required value={form.recipient.address.street}
                onChange={(e) => setRecipientAddr("street", e.target.value)} placeholder="San Martín 456" />
            </Field>
            <Field label="City *">
              <input style={input} required value={form.recipient.address.city}
                onChange={(e) => setRecipientAddr("city", e.target.value)} placeholder="Córdoba" />
            </Field>
          </Row2>
          <Row2>
            <Field label="Province *">
              <select style={input} required value={form.recipient.address.province}
                onChange={(e) => setRecipientAddr("province", e.target.value)}>
                <option value="">Select province</option>
                {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Postal Code *">
              <input style={input} required value={form.recipient.address.postal_code}
                onChange={(e) => setRecipientAddr("postal_code", e.target.value)} placeholder="X5000" />
            </Field>
          </Row2>
        </Section>

        {/* Receiving Branch */}
        <Section title="Receiving Branch">
          <Field label="Branch *">
            <select style={input} required value={form.receiving_branch_id}
              onChange={(e) => set("receiving_branch_id", e.target.value)}>
              <option value="">Select branch...</option>
              {(() => {
                const branchesByProvince = branches.reduce((acc, branch) => {
                  if (!acc[branch.province]) acc[branch.province] = [];
                  acc[branch.province].push(branch);
                  return acc;
                }, {} as Record<string, Branch[]>);

                return Object.entries(branchesByProvince)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([province, provinceBranches]) => (
                    <optgroup key={province} label={province}>
                      {[...provinceBranches]
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map(branch => (
                          <option key={branch.id} value={branch.id}>
                            {branch.name} - {branch.address.city}
                          </option>
                        ))}
                    </optgroup>
                  ));
              })()}
            </select>
            {form.receiving_branch_id && (() => {
              const selected = branches.find(b => b.id === form.receiving_branch_id);
              if (!selected) return null;
              return (
                <div style={{ marginTop: 8, padding: "8px 12px", background: "#f0f9ff", border: "1px solid #bfdbfe", borderRadius: 6, fontSize: 13 }}>
                  <div style={{ fontWeight: 600, color: "#1e3a5f" }}>{selected.name}</div>
                  <div style={{ color: "#6b7280" }}>{selected.address.street}, {selected.address.city}</div>
                </div>
              );
            })()}
          </Field>
        </Section>

        {/* Package */}
        <Section title="Package">
          <Row2>
            <Field label="Weight (kg) *">
              <input style={input} type="number" step="0.1" min="0.1" required
                value={form.weight_kg === 0 ? "" : form.weight_kg}
                onChange={(e) => set("weight_kg", parseFloat(e.target.value) || 0)} placeholder="3.5" />
            </Field>
            <Field label="Package Type *">
              <select style={input} required value={form.package_type}
                onChange={(e) => set("package_type", e.target.value as PackageType)}>
                {PACKAGE_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </Field>
          </Row2>
          <Row2>
            <Field label="Shipment Type">
              <select style={input} value={form.shipment_type ?? "normal"}
                onChange={(e) => set("shipment_type", e.target.value as ShipmentType)}>
                {SHIPMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Time Window">
              <select style={input} value={form.time_window ?? "flexible"}
                onChange={(e) => set("time_window", e.target.value as TimeWindow)}>
                {TIME_WINDOWS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
          </Row2>
          <Field label="">
            <div style={{ display: "flex", gap: 20 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={!!form.is_fragile}
                  onChange={(e) => set("is_fragile", e.target.checked)} />
                Fragile contents (handle with care)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={!!form.cold_chain}
                  onChange={(e) => set("cold_chain", e.target.checked)} />
                Cold chain (refrigerated)
              </label>
            </div>
          </Field>
          <Field label="Special Instructions">
            <input style={input} value={form.special_instructions}
              onChange={(e) => set("special_instructions", e.target.value)}
              placeholder='e.g. "Keep upright"' />
          </Field>
        </Section>

        {error && <p style={{ color: "#ef4444", margin: 0 }}>{error}</p>}

        <div style={{ display: "flex", gap: 12 }}>
          <button type="button" disabled={loading} onClick={handleSaveDraft}
            style={{ flex: 1, background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 8, padding: "12px", cursor: "pointer", fontWeight: 600, fontSize: 15 }}>
            {loading ? "Saving..." : "Save draft"}
          </button>
          <button type="submit" disabled={loading}
            style={{ flex: 1, background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 8, padding: "12px", cursor: "pointer", fontWeight: 700, fontSize: 15 }}>
            {loading ? "Creating..." : "Create shipment"}
          </button>
        </div>
      </form>
    </div>
  );
}

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "16px 20px" }}>
      <legend style={{ fontWeight: 700, fontSize: 14, color: "#1e3a5f", padding: "0 6px" }}>{title}</legend>
      <div style={{ display: "grid", gap: 12 }}>{children}</div>
    </fieldset>
  );
}

function Row2({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  return <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>{label}</label>
      {children}
    </div>
  );
}

const input: React.CSSProperties = {
  padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db",
  fontSize: 14, width: "100%", boxSizing: "border-box",
};

const backBtn: React.CSSProperties = {
  background: "none", border: "1px solid #d1d5db", borderRadius: 6,
  padding: "6px 12px", cursor: "pointer", fontSize: 14,
};
