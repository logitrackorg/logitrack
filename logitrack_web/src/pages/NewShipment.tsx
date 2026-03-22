import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { shipmentApi, type CreateShipmentPayload, type PackageType, type Shipment } from "../api/shipments";
import { branchApi, type Branch } from "../api/branches";
import { customerApi } from "../api/customers";
import { fmtDateTime } from "../utils/date";

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
  { value: "fragile",  label: "Fragile" },
];

const emptyAddress = { street: "", city: "", province: "", postal_code: "" };

const initialForm: CreateShipmentPayload = {
  sender_name: "", sender_phone: "", sender_email: "", sender_dni: "",
  origin: { ...emptyAddress },
  recipient_name: "", recipient_phone: "", recipient_email: "", recipient_dni: "",
  destination: { ...emptyAddress },
  weight_kg: 0,
  package_type: "box",
  special_instructions: "",
  receiving_branch_id: "",
};

export function NewShipment() {
  const [form, setForm] = useState<CreateShipmentPayload>(initialForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Shipment[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [senderAutofilled, setSenderAutofilled] = useState(false);
  const [recipientAutofilled, setRecipientAutofilled] = useState(false);
  const senderDNITimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recipientDNITimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    shipmentApi.list().then((all) => {
      setDrafts(all.filter((s) => s.status === "pending"));
    }).catch(() => {});
    branchApi.list().then(setBranches).catch(() => {});
  }, []);

  const set = (field: string, value: unknown) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSenderDNI = (dni: string) => {
    set("sender_dni", dni);
    setSenderAutofilled(false);
    if (senderDNITimer.current) clearTimeout(senderDNITimer.current);
    if (dni.length >= 7) {
      senderDNITimer.current = setTimeout(async () => {
        const customer = await customerApi.getByDNI(dni);
        if (customer) {
          setForm((prev) => ({
            ...prev,
            sender_name: customer.name,
            sender_phone: customer.phone,
            sender_email: customer.email ?? prev.sender_email,
            origin: {
              street: customer.address.street ?? prev.origin.street,
              city: customer.address.city || prev.origin.city,
              province: customer.address.province || prev.origin.province,
              postal_code: customer.address.postal_code ?? prev.origin.postal_code,
            },
          }));
          setSenderAutofilled(true);
        }
      }, 400);
    }
  };

  const handleRecipientDNI = (dni: string) => {
    set("recipient_dni", dni);
    setRecipientAutofilled(false);
    if (recipientDNITimer.current) clearTimeout(recipientDNITimer.current);
    if (dni.length >= 7) {
      recipientDNITimer.current = setTimeout(async () => {
        const customer = await customerApi.getByDNI(dni);
        if (customer) {
          setForm((prev) => ({
            ...prev,
            recipient_name: customer.name,
            recipient_phone: customer.phone,
            recipient_email: customer.email ?? prev.recipient_email,
            destination: {
              street: customer.address.street ?? prev.destination.street,
              city: customer.address.city || prev.destination.city,
              province: customer.address.province || prev.destination.province,
              postal_code: customer.address.postal_code ?? prev.destination.postal_code,
            },
          }));
          setRecipientAutofilled(true);
        }
      }, 400);
    }
  };

  const setAddr = (side: "origin" | "destination", field: string, value: string) =>
    setForm((prev) => ({ ...prev, [side]: { ...prev[side], [field]: value } }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
    setLoading(true);
    setError("");
    try {
      const shipment = await shipmentApi.saveDraft(form);
      navigate(`/shipments/${shipment.tracking_id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? "No se pudo guardar el borrador. Intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "24px 32px", maxWidth: 720, margin: "0 auto" }}>
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
                  <span style={{ fontWeight: 600 }}>{d.sender_name || "Sin nombre"}</span>
                  <span style={{ color: "#9ca3af", margin: "0 6px" }}>→</span>
                  <span>{d.recipient_name || "Sin nombre"}</span>
                  <span style={{ color: "#9ca3af", fontSize: 12, marginLeft: 10 }}>{fmtDateTime(d.created_at)}</span>
                </div>
                <button onClick={() => navigate(`/shipments/${d.tracking_id}`)}
                  style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "5px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
                  Retomar
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
              <input style={input} required value={form.sender_name}
                onChange={(e) => set("sender_name", e.target.value)} placeholder="e.g. Carlos Mendez" />
            </Field>
            <Field label="Phone *">
              <input style={input} required value={form.sender_phone}
                onChange={(e) => set("sender_phone", e.target.value)} placeholder="+54 9 11 1234-5678" />
            </Field>
          </Row2>
          <Row2>
            <Field label="Email">
              <input style={input} type="email" value={form.sender_email}
                onChange={(e) => set("sender_email", e.target.value)} placeholder="optional" />
            </Field>
            <Field label={senderAutofilled ? "DNI * ✓ datos autocompletados" : "DNI *"}>
              <input style={input} required value={form.sender_dni}
                onChange={(e) => handleSenderDNI(e.target.value)} placeholder="Ej: 30123456" />
            </Field>
          </Row2>
          <Row2>
            <Field label="Street">
              <input style={input} value={form.origin.street}
                onChange={(e) => setAddr("origin", "street", e.target.value)} placeholder="Av. Corrientes 1234" />
            </Field>
            <Field label="City *">
              <input style={input} required value={form.origin.city}
                onChange={(e) => setAddr("origin", "city", e.target.value)} placeholder="Buenos Aires" />
            </Field>
          </Row2>
          <Row2>
            <Field label="Province *">
              <select style={input} required value={form.origin.province}
                onChange={(e) => setAddr("origin", "province", e.target.value)}>
                <option value="">Select province</option>
                {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Postal Code">
              <input style={input} value={form.origin.postal_code}
                onChange={(e) => setAddr("origin", "postal_code", e.target.value)} placeholder="C1043" />
            </Field>
          </Row2>
        </Section>

        {/* Recipient */}
        <Section title="Recipient">
          <Row2>
            <Field label="Full Name *">
              <input style={input} required value={form.recipient_name}
                onChange={(e) => set("recipient_name", e.target.value)} placeholder="e.g. Laura Gomez" />
            </Field>
            <Field label="Phone *">
              <input style={input} required value={form.recipient_phone}
                onChange={(e) => set("recipient_phone", e.target.value)} placeholder="+54 9 351 678-4321" />
            </Field>
          </Row2>
          <Row2>
            <Field label="Email">
              <input style={input} type="email" value={form.recipient_email}
                onChange={(e) => set("recipient_email", e.target.value)} placeholder="optional" />
            </Field>
            <Field label={recipientAutofilled ? "DNI * ✓ datos autocompletados" : "DNI *"}>
              <input style={input} required value={form.recipient_dni}
                onChange={(e) => handleRecipientDNI(e.target.value)} placeholder="Ej: 28456789" />
            </Field>
          </Row2>
          <Row2>
            <Field label="Street">
              <input style={input} value={form.destination.street}
                onChange={(e) => setAddr("destination", "street", e.target.value)} placeholder="San Martín 456" />
            </Field>
            <Field label="City *">
              <input style={input} required value={form.destination.city}
                onChange={(e) => setAddr("destination", "city", e.target.value)} placeholder="Córdoba" />
            </Field>
          </Row2>
          <Row2>
            <Field label="Province *">
              <select style={input} required value={form.destination.province}
                onChange={(e) => setAddr("destination", "province", e.target.value)}>
                <option value="">Select province</option>
                {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Postal Code">
              <input style={input} value={form.destination.postal_code}
                onChange={(e) => setAddr("destination", "postal_code", e.target.value)} placeholder="X5000" />
            </Field>
          </Row2>
        </Section>

        {/* Receiving Branch */}
        <Section title="Receiving Branch">
          <Field label="Branch *">
            <select style={input} required value={form.receiving_branch_id}
              onChange={(e) => set("receiving_branch_id", e.target.value)}>
              <option value="">Select branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
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
          <Field label="Special Instructions">
            <input style={input} value={form.special_instructions}
              onChange={(e) => set("special_instructions", e.target.value)}
              placeholder='e.g. "Fragile — glass items"' />
          </Field>
        </Section>

        {error && <p style={{ color: "#ef4444", margin: 0 }}>{error}</p>}

        <div style={{ display: "flex", gap: 12 }}>
          <button type="button" disabled={loading} onClick={handleSaveDraft}
            style={{ flex: 1, background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 8, padding: "12px", cursor: "pointer", fontWeight: 600, fontSize: 15 }}>
            {loading ? "Guardando..." : "Guardar borrador"}
          </button>
          <button type="submit" disabled={loading}
            style={{ flex: 1, background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 8, padding: "12px", cursor: "pointer", fontWeight: 700, fontSize: 15 }}>
            {loading ? "Creando..." : "Crear envío"}
          </button>
        </div>
      </form>
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
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>{children}</div>;
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
