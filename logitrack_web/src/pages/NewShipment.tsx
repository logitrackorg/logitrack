import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, PackagePlus, AlertTriangle, FileText, X, AlertCircle, MapPin, Tag, User, UserCheck, Box, Loader2, Check } from "lucide-react";
import { shipmentApi, type CreateShipmentPayload, type PackageType, type ShipmentType, type TimeWindow, type DeliveryMethod, type Shipment } from "../api/shipments";
import { paymentApi, type Payment } from "../api/payments";
import { branchApi, type Branch, type BranchCapacity } from "../api/branches";
import { customerApi, type Customer } from "../api/customers";
import { useIsMobile } from "../hooks/useIsMobile";
import { useAuth } from "../context/AuthContext";
import { AddressAutocomplete, type AddressParts } from "../components/AddressAutocomplete";
import { pricingApi, formatCurrencyARS, type QuoteResponse } from "../api/pricing";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { GradientCard, GradientCardIcon, GradientCardLabel, GradientCardValue } from "../components/ui/gradient-card";
import ShipmentQRModal from "../components/ShipmentQRModal";

const PROVINCES = [
  "Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes",
  "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza",
  "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis",
  "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán",
];

const PACKAGE_TYPES: { value: PackageType; label: string }[] = [
  { value: "envelope", label: "Sobre" },
  { value: "box",      label: "Caja" },
];

const SHIPMENT_TYPES: { value: ShipmentType; label: string }[] = [
  { value: "normal",  label: "Normal" },
  { value: "express", label: "Express" },
];

const TIME_WINDOWS: { value: TimeWindow; label: string }[] = [
  { value: "flexible",  label: "Flexible" },
  { value: "morning",   label: "Mañana (8-12)" },
  { value: "afternoon", label: "Tarde (12-18)" },
];

const DELIVERY_METHODS: { value: DeliveryMethod; label: string; description: string }[] = [
  { value: "ultima_milla",    label: "Última milla", description: "Entrega a domicilio del destinatario (≤ 50 km de la sucursal final)" },
  { value: "retiro_sucursal", label: "Retiro en sucursal", description: "El destinatario retira el envío en la sucursal de destino" },
];

const reName = /^[a-zA-ZÀ-ÖØ-öø-ÿñÑ\s'-]+$/;
const validateName = (name: string) =>
  name && !reName.test(name) ? "El nombre no puede contener números ni caracteres especiales" : "";

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findFinalBranch(recipientAddress: { province?: string; latitude?: number; longitude?: number }, branches: Branch[]): Branch | null {
  const active = branches.filter(b => b.status === "activo");
  if (!active.length) return null;
  if (recipientAddress.latitude != null && recipientAddress.longitude != null) {
    let best: Branch | null = null;
    let minDist = Infinity;
    for (const b of active) {
      if (b.latitude != null && b.longitude != null) {
        const d = haversineKm(recipientAddress.latitude!, recipientAddress.longitude!, b.latitude, b.longitude);
        if (d < minDist) { minDist = d; best = b; }
      }
    }
    if (best) return best;
  }
  if (recipientAddress.province) {
    const match = active.find(b => b.province === recipientAddress.province);
    if (match) return match;
  }
  return null;
}

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
  delivery_method: "ultima_milla",
  receiving_branch_id: "",
};

export function NewShipment() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const branchLocked = (user?.role === "operator" || user?.role === "supervisor") && !!user?.branch_id;
  const [form, setForm] = useState<CreateShipmentPayload>({
    ...initialForm,
    receiving_branch_id: branchLocked ? (user?.branch_id ?? "") : "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [senderNameError, setSenderNameError] = useState("");
  const [recipientNameError, setRecipientNameError] = useState("");
  const [drafts, setDrafts] = useState<Shipment[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [senderSuggestion, setSenderSuggestion] = useState<Customer | null>(null);
  const [recipientSuggestion, setRecipientSuggestion] = useState<Customer | null>(null);
  const [branchCapacity, setBranchCapacity] = useState<BranchCapacity | null>(null);
  const [capacityConfirmed, setCapacityConfirmed] = useState(false);
  const senderDNITimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recipientDNITimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-save draft state
  type AutoSaveStatus = "idle" | "saving" | "saved" | "error";
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>("idle");
  const [autoSaveError, setAutoSaveError] = useState("");
  const draftIdRef = useRef<string | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Payment modal state
  const [paymentModal, setPaymentModal] = useState<{ payment: Payment; trackingId: string } | null>(null);
  const paymentPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const navigate = useNavigate();

  useEffect(() => {
    shipmentApi.list().then((all) => {
      setDrafts(all.filter((s) => s.status === "draft"));
    }).catch(() => {});
    branchApi.listActive().then(setBranches).catch(() => {});
  }, []);

  useEffect(() => {
    setBranchCapacity(null);
    setCapacityConfirmed(false);
    if (!form.receiving_branch_id) return;
    branchApi.getCapacity(form.receiving_branch_id).then(setBranchCapacity).catch(() => {});
  }, [form.receiving_branch_id]);

  // Live pricing quote — debounced 400ms when relevant fields change.
  // Origin is the receiving branch address (where the shipment departs from),
  // falling back to the sender's address if no branch is selected yet.
  useEffect(() => {
    const selectedBranch = branches.find((b) => b.id === form.receiving_branch_id);
    const originAddress = selectedBranch
      ? { street: selectedBranch.address.street, city: selectedBranch.address.city, province: selectedBranch.province, postal_code: selectedBranch.address.postal_code, latitude: selectedBranch.latitude, longitude: selectedBranch.longitude }
      : form.sender.address;
    const finalBranch = findFinalBranch(form.recipient.address, branches);
    const destinationAddress = finalBranch
      ? { street: finalBranch.address.street, city: finalBranch.address.city, province: finalBranch.province, postal_code: finalBranch.address.postal_code, latitude: finalBranch.latitude, longitude: finalBranch.longitude }
      : form.recipient.address;
    const hasMinData = form.weight_kg > 0 && !!form.package_type && !!originAddress.province && !!destinationAddress.province;
    if (!hasMinData) {
      setQuote(null);
      return;
    }
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    quoteTimer.current = setTimeout(async () => {
      setQuoteLoading(true);
      try {
        const q = await pricingApi.quote({
          weight_kg: form.weight_kg,
          package_type: form.package_type,
          shipment_type: form.shipment_type,
          time_window: form.time_window,
          is_fragile: form.is_fragile,
          delivery_method: form.delivery_method,
          origin: originAddress,
          destination: destinationAddress,
        });
        setQuote(q);
      } catch {
        setQuote(null);
      } finally {
        setQuoteLoading(false);
      }
    }, 400);
    return () => {
      if (quoteTimer.current) clearTimeout(quoteTimer.current);
    };
  }, [
    form.weight_kg,
    form.package_type,
    form.shipment_type,
    form.time_window,
    form.is_fragile,
    form.delivery_method,
    form.receiving_branch_id,
    form.sender.address,
    form.recipient.address,
    branches,
  ]);

  // Auto-save: fires 1 s after the last change, as long as both DNIs are present.
  useEffect(() => {
    const senderDni = form.sender.dni.trim();
    const recipientDni = form.recipient.dni.trim();
    if (senderDni.length < 7 || recipientDni.length < 7) return;

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      setAutoSaveStatus("saving");
      setAutoSaveError("");
      try {
        if (draftIdRef.current) {
          await shipmentApi.updateDraft(draftIdRef.current, form);
        } else {
          const saved = await shipmentApi.saveDraft(form);
          draftIdRef.current = saved.tracking_id;
          // Refresh draft count in the banner
          setDrafts((prev) => [...prev, saved]);
        }
        setAutoSaveStatus("saved");
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setAutoSaveError(msg ?? "No se pudo guardar el borrador.");
        setAutoSaveStatus("error");
      }
    }, 1000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [form]);

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

  const applySenderAddress = (parts: AddressParts) =>
    setForm((prev) => ({
      ...prev,
      sender: {
        ...prev.sender,
        address: {
          ...prev.sender.address,
          ...(parts.street && { street: parts.street }),
          ...(parts.city && { city: parts.city }),
          ...(parts.province && { province: parts.province }),
          ...(parts.postal_code && { postal_code: parts.postal_code }),
          ...(parts.latitude !== undefined && { latitude: parts.latitude }),
          ...(parts.longitude !== undefined && { longitude: parts.longitude }),
        },
      },
    }));

  const applyRecipientAddress = (parts: AddressParts) =>
    setForm((prev) => ({
      ...prev,
      recipient: {
        ...prev.recipient,
        address: {
          ...prev.recipient.address,
          ...(parts.street && { street: parts.street }),
          ...(parts.city && { city: parts.city }),
          ...(parts.province && { province: parts.province }),
          ...(parts.postal_code && { postal_code: parts.postal_code }),
          ...(parts.latitude !== undefined && { latitude: parts.latitude }),
          ...(parts.longitude !== undefined && { longitude: parts.longitude }),
        },
      },
    }));

  const handleSenderName = (name: string) => {
    setSender("name", name);
    setSenderNameError(validateName(name));
  };
  const handleRecipientName = (name: string) => {
    setRecipient("name", name);
    setRecipientNameError(validateName(name));
  };

  const handleSenderDNI = (raw: string) => {
    const dni = raw.trim();
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

  const handleRecipientDNI = (raw: string) => {
    const dni = raw.trim();
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
    if (!form.sender.phone) { setError("El teléfono del remitente es obligatorio."); return; }
    if (!form.recipient.phone) { setError("El teléfono del destinatario es obligatorio."); return; }
    const sne = validateName(form.sender.name); if (sne) { setError(sne); return; }
    const rne = validateName(form.recipient.name); if (rne) { setError(rne); return; }
    if (form.sender.dni.length < 7) { setError("El DNI del remitente debe tener al menos 7 dígitos."); return; }
    if (form.recipient.dni.length < 7) { setError("El DNI del destinatario debe tener al menos 7 dígitos."); return; }
    if (!form.weight_kg || form.weight_kg <= 0) { setError("El peso debe ser mayor a 0."); return; }
    if (!form.sender.address.street) { setError("La calle del remitente es obligatoria."); return; }
    if (!form.recipient.address.street) { setError("La calle del destinatario es obligatoria."); return; }
    if (/^\d+$/.test(form.sender.address.city)) { setError("La ciudad del remitente no puede contener solo números."); return; }
    if (/^\d+$/.test(form.recipient.address.city)) { setError("La ciudad del destinatario no puede contener solo números."); return; }
    if (!form.sender.address.postal_code) { setError("El código postal del remitente es obligatorio."); return; }
    if (/^[a-zA-Z]+$/.test(form.sender.address.postal_code)) { setError("El código postal del remitente debe contener al menos un dígito."); return; }
    if (!form.recipient.address.postal_code) { setError("El código postal del destinatario es obligatorio."); return; }
    if (/^[a-zA-Z]+$/.test(form.recipient.address.postal_code)) { setError("El código postal del destinatario debe contener al menos un dígito."); return; }
    const branchAtLimit = branchCapacity != null && branchCapacity.current >= branchCapacity.max_capacity;
    if (branchAtLimit && !capacityConfirmed) { setError("La sucursal receptora está al límite de capacidad. Confirmá que querés continuar de todas formas."); return; }
    setLoading(true);
    setError("");
    try {
      let draftId = draftIdRef.current;
      if (draftId) {
        await shipmentApi.updateDraft(draftId, form as Parameters<typeof shipmentApi.updateDraft>[1]);
      } else {
        const saved = await shipmentApi.saveDraft(form as Parameters<typeof shipmentApi.saveDraft>[0]);
        draftId = saved.tracking_id;
        draftIdRef.current = draftId;
      }
      const payment = await paymentApi.requestPayment(draftId!);
      setPaymentModal({ payment, trackingId: draftId! });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? "No se pudo iniciar el pago. Por favor, intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (<>
    <div className={`${isMobile ? "p-4" : "p-6 md:px-8"} max-w-3xl mx-auto`}>
      <button
        onClick={() => navigate("/")}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        Volver al listado
      </button>

      <div className="flex items-start gap-3 mb-6 pb-4 border-b border-slate-200">
        <div className="w-10 h-10 rounded-xl bg-[#1e3a5f]/8 text-[#1e3a5f] flex items-center justify-center shrink-0">
          <PackagePlus className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight leading-tight">Nuevo envío</h1>
            {/* Auto-save status indicator */}
            {autoSaveStatus === "saving" && (
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                <Loader2 className="w-3 h-3 animate-spin" />Guardando borrador…
              </span>
            )}
            {autoSaveStatus === "saved" && (
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600">
                <Check className="w-3 h-3" />Borrador guardado
              </span>
            )}
            {autoSaveStatus === "error" && (
              <span className="inline-flex items-center gap-1.5 text-xs text-rose-500">
                <AlertCircle className="w-3 h-3" />{autoSaveError || "Error al guardar"}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Completá los datos para registrar un envío.{" "}
            <span className="text-slate-400">El borrador se guarda automáticamente al ingresar el DNI del remitente y del destinatario.</span>
          </p>
        </div>
      </div>

      {branchCapacity != null && branchCapacity.current >= branchCapacity.max_capacity && (
        <div className="flex items-start gap-3 mb-5 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-amber-900">La sucursal receptora está al límite de capacidad</p>
            <p className="mt-1 text-xs text-amber-800 leading-relaxed">
              Tiene {branchCapacity.current} de {branchCapacity.max_capacity} bultos ({branchCapacity.percentage}% de ocupación). Podés continuar, pero la sucursal estará por encima de su capacidad.
            </p>
          </div>
        </div>
      )}

      {drafts.length > 0 && (
        <button
          type="button"
          onClick={() => navigate("/drafts")}
          className="w-full mb-5 flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 transition-colors cursor-pointer group"
        >
          <div className="flex items-center gap-2.5">
            <FileText className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="text-sm font-semibold text-amber-900">
              Tenés {drafts.length} {drafts.length === 1 ? "borrador guardado" : "borradores guardados"}
            </span>
          </div>
          <span className="text-xs font-semibold text-amber-700 group-hover:underline shrink-0">
            Ver borradores →
          </span>
        </button>
      )}

      <form onSubmit={handleSubmit} className="grid gap-5">

        {/* Remitente */}
        <Section title="Remitente" icon={<User className="w-4 h-4" />}
          subtitle="El DNI del remitente y del destinatario son necesarios para el guardado automático del borrador."
        >
          <Row2>
            <Field label="DNI *">
              <div style={{ position: "relative" }}>
                <input style={input} required value={form.sender.dni}
                  onChange={(e) => handleSenderDNI(e.target.value)} placeholder="Ej: 30123456" />
                {senderSuggestion && (
                  <CustomerSuggestion customer={senderSuggestion} onApply={applySenderSuggestion} onDismiss={() => setSenderSuggestion(null)} />
                )}
              </div>
            </Field>
            <Field label="Nombre completo *">
              <input style={{ ...input, borderColor: senderNameError ? "#ef4444" : undefined }} required value={form.sender.name}
                onChange={(e) => handleSenderName(e.target.value)} placeholder="ej: Carlos Mendez" />
              {senderNameError && <span style={{ color: "#ef4444", fontSize: 12 }}>{senderNameError}</span>}
            </Field>
          </Row2>
          <Row2>
            <Field label="Teléfono *">
              <input style={input} required value={form.sender.phone}
                onChange={(e) => setSender("phone", e.target.value.replace(/\D/g, ""))} placeholder="5491112345678" />
            </Field>
            <Field label="Email">
              <input style={input} type="email" value={form.sender.email}
                onChange={(e) => setSender("email", e.target.value)} placeholder="opcional" />
            </Field>
          </Row2>
          <Row2>
            <Field label="Calle *">
              <AddressAutocomplete
                style={input}
                required
                value={form.sender.address.street}
                onChange={(street) => setSenderAddr("street", street)}
                onAddressSelect={applySenderAddress}
                placeholder="Av. Corrientes 1234"
              />
            </Field>
            <Field label="Ciudad *">
              <input style={input} required value={form.sender.address.city}
                onChange={(e) => setSenderAddr("city", e.target.value)} placeholder="Buenos Aires" />
            </Field>
          </Row2>
          <Row2>
            <Field label="Provincia *">
              <select style={input} required value={form.sender.address.province}
                onChange={(e) => setSenderAddr("province", e.target.value)}>
                <option value="">Seleccioná una provincia</option>
                {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Código postal *">
              <input style={input} required value={form.sender.address.postal_code}
                onChange={(e) => setSenderAddr("postal_code", e.target.value)} placeholder="C1043" />
            </Field>
          </Row2>
        </Section>

        {/* Destinatario */}
        <Section title="Destinatario" icon={<UserCheck className="w-4 h-4" />}>
          <Row2>
            <Field label="DNI *">
              <div style={{ position: "relative" }}>
                <input style={input} required value={form.recipient.dni}
                  onChange={(e) => handleRecipientDNI(e.target.value)} placeholder="Ej: 28456789" />
                {recipientSuggestion && (
                  <CustomerSuggestion customer={recipientSuggestion} onApply={applyRecipientSuggestion} onDismiss={() => setRecipientSuggestion(null)} />
                )}
              </div>
            </Field>
            <Field label="Nombre completo *">
              <input style={{ ...input, borderColor: recipientNameError ? "#ef4444" : undefined }} required value={form.recipient.name}
                onChange={(e) => handleRecipientName(e.target.value)} placeholder="ej: Laura Gomez" />
              {recipientNameError && <span style={{ color: "#ef4444", fontSize: 12 }}>{recipientNameError}</span>}
            </Field>
          </Row2>
          <Row2>
            <Field label="Teléfono *">
              <input style={input} required value={form.recipient.phone}
                onChange={(e) => setRecipient("phone", e.target.value.replace(/\D/g, ""))} placeholder="5493516784321" />
            </Field>
            <Field label="Email">
              <input style={input} type="email" value={form.recipient.email}
                onChange={(e) => setRecipient("email", e.target.value)} placeholder="opcional" />
            </Field>
          </Row2>
          <Row2>
            <Field label="Calle *">
              <AddressAutocomplete
                style={input}
                required
                value={form.recipient.address.street}
                onChange={(street) => setRecipientAddr("street", street)}
                onAddressSelect={applyRecipientAddress}
                placeholder="San Martín 456"
              />
            </Field>
            <Field label="Ciudad *">
              <input style={input} required value={form.recipient.address.city}
                onChange={(e) => setRecipientAddr("city", e.target.value)} placeholder="Córdoba" />
            </Field>
          </Row2>
          <Row2>
            <Field label="Provincia *">
              <select style={input} required value={form.recipient.address.province}
                onChange={(e) => setRecipientAddr("province", e.target.value)}>
                <option value="">Seleccioná una provincia</option>
                {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Código postal *">
              <input style={input} required value={form.recipient.address.postal_code}
                onChange={(e) => setRecipientAddr("postal_code", e.target.value)} placeholder="X5000" />
            </Field>
          </Row2>
          {/* CA-05: Privacy notice — shown once the operator starts filling in recipient data */}
          {(form.recipient.name || form.recipient.dni) && (
            <div style={{
              marginTop: 8,
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid #e0f2fe",
              background: "#f0f9ff",
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
            }}>
              <span style={{ fontSize: 15, lineHeight: 1, marginTop: 1 }}>ℹ️</span>
              <p style={{ fontSize: 12, color: "#0369a1", margin: 0, lineHeight: 1.5 }}>
                Los datos personales del destinatario se conservarán según la política de retención de borradores vigente y serán tratados conforme a la{" "}
                <strong>Ley 25.326 de Protección de Datos Personales</strong>.{" "}
                Si el borrador no se confirma, los datos serán eliminados automáticamente pasado el período de vigencia.
              </p>
            </div>
          )}
        </Section>

        {/* Sucursales */}
        <Section title="Sucursales" icon={<MapPin className="w-4 h-4" />}>
          {/* Sucursal de origen */}
          <div className="grid gap-1.5">
            <label className="text-xs font-semibold text-slate-700">Sucursal de origen *</label>
            {branchLocked ? (() => {
              const selected = branches.find(b => b.id === form.receiving_branch_id);
              return (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
                  <p className="text-sm font-semibold text-[#1e3a5f]">{selected?.name ?? form.receiving_branch_id}</p>
                  {selected && <p className="text-xs text-slate-600 mt-0.5">{selected.address.street}, {selected.address.city}</p>}
                  <p className="mt-1.5 text-[11px] text-slate-500">Asignada a tu sucursal — no se puede cambiar.</p>
                </div>
              );
            })() : (
              <>
                <select style={input} required value={form.receiving_branch_id}
                  onChange={(e) => set("receiving_branch_id", e.target.value)}>
                  <option value="">Seleccioná una sucursal...</option>
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
                    <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                      <p className="text-sm font-semibold text-[#1e3a5f]">{selected.name}</p>
                      <p className="text-xs text-slate-600 mt-0.5">{selected.address.street}, {selected.address.city}</p>
                    </div>
                  );
                })()}
              </>
            )}
          </div>

          {/* Sucursal final */}
          {(() => {
            const finalBranch = findFinalBranch(form.recipient.address, branches);
            if (!finalBranch) return null;
            return (
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-slate-700">Sucursal final</label>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                  <p className="text-sm font-semibold text-[#1e3a5f]">{finalBranch.name}</p>
                  <p className="text-xs text-slate-600 mt-0.5">{finalBranch.address.street}, {finalBranch.address.city}</p>
                  <p className="mt-1.5 text-[11px] text-slate-500">Sucursal más cercana al domicilio del destinatario.</p>
                </div>
              </div>
            );
          })()}
        </Section>

        {/* Paquete */}
        <Section title="Paquete" icon={<Box className="w-4 h-4" />}>
          <Row2>
            <Field label="Peso (kg) *">
              <input style={input} type="number" step="0.1" min="0.1" required
                value={form.weight_kg === 0 ? "" : form.weight_kg}
                onChange={(e) => set("weight_kg", parseFloat(e.target.value) || 0)} placeholder="3.5" />
            </Field>
            <Field
              label="Tipo de paquete *"
              error={form.package_type === "envelope" && form.weight_kg > 5 ? "Máximo 5 kg para sobre" : undefined}
            >
              <select style={input} required value={form.package_type}
                onChange={(e) => set("package_type", e.target.value as PackageType)}>
                {PACKAGE_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </Field>
          </Row2>
          <Row2>
            <Field label="Tipo de envío">
              <select style={input} value={form.shipment_type ?? "normal"}
                onChange={(e) => set("shipment_type", e.target.value as ShipmentType)}>
                {SHIPMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            {form.delivery_method !== "retiro_sucursal" && (
              <Field label="Ventana horaria">
                <select style={input} value={form.time_window ?? "flexible"}
                  onChange={(e) => set("time_window", e.target.value as TimeWindow)}>
                  {TIME_WINDOWS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
            )}
          </Row2>
          <Field label="Método de entrega *">
            <div className="flex flex-col gap-2">
              {DELIVERY_METHODS.map((m) => {
                const selected = form.delivery_method === m.value;
                return (
                  <label
                    key={m.value}
                    className={`flex items-start gap-3 cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${
                      selected
                        ? "border-[#2563eb] bg-blue-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="delivery_method"
                      value={m.value}
                      checked={selected}
                      onChange={() => {
                        set("delivery_method", m.value);
                        if (m.value === "retiro_sucursal") set("time_window", "flexible");
                      }}
                      className="mt-0.5 shrink-0 accent-[#2563eb]"
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="font-semibold text-sm text-slate-900">{m.label}</span>
                      <span className="text-xs text-slate-500">{m.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </Field>
          <Field label="">
            <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-slate-700 select-none">
              <input
                type="checkbox"
                checked={!!form.is_fragile}
                onChange={(e) => set("is_fragile", e.target.checked)}
                className="accent-[#2563eb]"
              />
              <span className="font-medium">Contenido frágil</span>
              <span className="text-slate-500 text-xs">(manipular con cuidado)</span>
            </label>
          </Field>
          <Field label="Instrucciones especiales">
            <input style={input} value={form.special_instructions}
              onChange={(e) => set("special_instructions", e.target.value)}
              placeholder='ej: "Mantener vertical"' />
          </Field>
        </Section>

        {(quote || quoteLoading) && (
          <PricingCard quote={quote} loading={quoteLoading} />
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 border-l-4 border-l-rose-600"
          >
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-rose-900">No se pudo procesar la solicitud</p>
              <p className="mt-0.5 text-sm text-rose-800 leading-relaxed break-words">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => setError("")}
              aria-label="Cerrar mensaje"
              className="p-1 rounded text-rose-600 hover:bg-rose-100 cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {branchCapacity != null && branchCapacity.current >= branchCapacity.max_capacity && (
          <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <input
              type="checkbox"
              checked={capacityConfirmed}
              onChange={(e) => setCapacityConfirmed(e.target.checked)}
              className="mt-0.5 shrink-0 accent-amber-600"
            />
            <span className="text-sm font-semibold text-amber-900">
              Entiendo que la sucursal receptora está al límite de capacidad y quiero crear el envío de todas formas
            </span>
          </label>
        )}

        {(() => {
          const atLimit = branchCapacity != null && branchCapacity.current >= branchCapacity.max_capacity;
          const envelopeTooHeavy = form.package_type === "envelope" && form.weight_kg > 5;
          const blocked = (atLimit && !capacityConfirmed) || envelopeTooHeavy;
          return (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-slate-400 text-center">Los cambios se guardan automáticamente</p>
              <button
                type="submit"
                disabled={loading || blocked}
                className="w-full h-11 rounded-lg bg-[#1e3a5f] hover:bg-[#15294a] text-sm font-bold text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                {loading ? "Procesando…" : "Crear envío y pagar"}
              </button>
            </div>
          );
        })()}
      </form>
    </div>
    {paymentModal && (
      <PaymentModal
        payment={paymentModal.payment}
        trackingId={paymentModal.trackingId}
        onApproved={(newTrackingId) => {
          if (paymentPollRef.current) clearInterval(paymentPollRef.current);
          setPaymentModal(null);
          navigate(`/shipments/${newTrackingId}`);
        }}
        onBackToDraft={async () => {
          if (paymentPollRef.current) clearInterval(paymentPollRef.current);
          try {
            await paymentApi.backToDraft(paymentModal.trackingId);
          } catch {
            // ignore — draft state is best-effort
          }
          setPaymentModal(null);
          draftIdRef.current = paymentModal.trackingId;
        }}
        pollRef={paymentPollRef}
      />
    )}
    </> );
}

function PaymentModal({
  payment,
  trackingId,
  onApproved,
  onBackToDraft,
  pollRef,
}: {
  payment: Payment;
  trackingId: string;
  onApproved: (newTrackingId: string) => void;
  onBackToDraft: () => void;
  pollRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>;
}) {
  const [status, setStatus] = useState<Payment["status"]>(payment.status);
  const [polling, setPolling] = useState(true);
  const [showQR, setShowQR] = useState(false);
  const [qrBase64, setQrBase64] = useState("");
  const [qrError, setQrError] = useState("");

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const updated = await paymentApi.get(trackingId);
        setStatus(updated.status);
        if (updated.status === "approved") {
          if (pollRef.current) clearInterval(pollRef.current);
          setPolling(false);
          // The shipment tracking_id changed to LT-; we need to find it.
          // Since the payment record stores the old BORRADOR- id,
          // redirect to shipment list filtered by pending_payment and let the user navigate,
          // or just go to the list. A cleaner approach: the backend could return new_tracking_id.
          // For now, navigate to root and the user finds the confirmed shipment.
          onApproved(updated.tracking_id); // tracking_id was updated to LT- in DB
        }
        if (updated.status === "abandoned") {
          if (pollRef.current) clearInterval(pollRef.current);
          setPolling(false);
        }
      } catch {
        // ignore poll errors
      }
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [trackingId, onApproved, pollRef]);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      <div style={{
        background: "#fff", borderRadius: 16, padding: 32, maxWidth: 420, width: "100%",
        margin: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>💳</div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#1e3a5f", margin: 0 }}>
            Pago pendiente
          </h2>
          <p style={{ fontSize: 13, color: "#64748b", marginTop: 6 }}>
            Monto a cobrar: <strong style={{ color: "#1e3a5f" }}>
              {new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(payment.amount)}
            </strong>
          </p>
        </div>

        {status === "pending" && (
          <>
            {payment.init_point && (
              <>
                <CopyLinkButton url={payment.init_point} />
                <button
                  onClick={async () => {
                    setQrError("");
                    try {
                      const { qr_code_base64 } = await paymentApi.getQR(trackingId);
                      setQrBase64(qr_code_base64);
                      setShowQR(true);
                    } catch {
                      setQrError("No se pudo generar el QR de pago.");
                    }
                  }}
                  style={{
                    display: "block", width: "100%", textAlign: "center",
                    background: "#fff", color: "#009ee3",
                    border: "1px solid #009ee3",
                    borderRadius: 10, padding: "10px 0",
                    fontWeight: 700, fontSize: 14, cursor: "pointer",
                    marginBottom: 12,
                  }}
                >
                  📱 Mostrar QR de cobro
                </button>
                {qrError && <p style={{ fontSize: 12, color: "#dc2626", textAlign: "center", marginBottom: 8 }}>{qrError}</p>}
              </>
            )}
            {payment.simulate_enabled && (
              <button
                onClick={async () => {
                  if (pollRef.current) clearInterval(pollRef.current);
                  const result = await paymentApi.simulateApproved(trackingId);
                  onApproved(result.tracking_id);
                }}
                style={{
                  display: "block", width: "100%", textAlign: "center",
                  background: "#f0fdf4", color: "#16a34a",
                  border: "1px dashed #86efac",
                  borderRadius: 10, padding: "10px 0",
                  fontWeight: 600, fontSize: 13, cursor: "pointer",
                  marginBottom: 12,
                }}
              >
                ⚡ Simular pago aprobado (demo)
              </button>
            )}
            <p style={{ fontSize: 11, color: "#94a3b8", textAlign: "center", marginBottom: 16 }}>
              {polling && payment.init_point ? "Esperando confirmación de pago…" : ""}
            </p>
          </>
        )}

        {status === "approved" && (
          <div style={{
            textAlign: "center", background: "#ecfdf5", borderRadius: 10,
            padding: 16, marginBottom: 16, color: "#16a34a", fontWeight: 600,
          }}>
            ✓ Pago confirmado — redirigiendo…
          </div>
        )}

        <button
          onClick={onBackToDraft}
          style={{
            width: "100%", padding: "10px 0",
            border: "1px solid #e2e8f0", borderRadius: 10,
            background: "#fff", color: "#64748b",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          Volver a editar el borrador
        </button>
      </div>
      <ShipmentQRModal
        isOpen={showQR}
        onClose={() => setShowQR(false)}
        trackingId={trackingId}
        qrCodeBase64={qrBase64}
        title="💳 QR de cobro"
        subtitle="El remitente puede escanear este código con su celular para completar el pago."
        variant="payment"
      />
    </div>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      style={{
        display: "block", width: "100%", textAlign: "center",
        background: copied ? "#f0fdf4" : "#fff",
        color: copied ? "#16a34a" : "#374151",
        border: `1px solid ${copied ? "#86efac" : "#d1d5db"}`,
        borderRadius: 10, padding: "10px 0",
        fontWeight: 600, fontSize: 14, cursor: "pointer",
        marginBottom: 8, transition: "all 0.2s",
      }}
    >
      {copied ? "✓ Link copiado" : "Copiar link de pago"}
    </button>
  );
}

function PricingCard({ quote, loading }: { quote: QuoteResponse | null; loading: boolean }) {
  return (
    <GradientCard tone="brand">
      <div className="flex items-start gap-3 mb-3">
        <GradientCardIcon><Tag className="w-5 h-5" /></GradientCardIcon>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <GradientCardLabel>Cotización del envío</GradientCardLabel>
            {loading && <span className="text-[11px] text-white/70">Calculando…</span>}
          </div>
          {quote ? (
            <>
              <GradientCardValue className="mt-1">{formatCurrencyARS(quote.total)}</GradientCardValue>
              <p className="mt-1 text-[11px] text-white/60">Precio estimado. Se confirma al crear el envío.</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-white/80">
              Completá peso, tipo de paquete y direcciones para ver la cotización.
            </p>
          )}
        </div>
      </div>
      {quote && (
        <>
          <div className="grid gap-1.5 text-xs pt-3 border-t border-white/15">
            <BreakdownRow label="Tarifa base" value={formatCurrencyARS(quote.breakdown.base_fare)} />
            <BreakdownRow
              label={`Distancia (${quote.breakdown.distance_km.toFixed(1)} km)`}
              value={formatCurrencyARS(quote.breakdown.distance_cost)}
            />
            {quote.breakdown.weight_surcharge > 0 && (
              <BreakdownRow label="Recargo por peso" value={formatCurrencyARS(quote.breakdown.weight_surcharge)} />
            )}
            {quote.breakdown.last_mile_surcharge > 0 && (
              <BreakdownRow label="Entrega a domicilio" value={formatCurrencyARS(quote.breakdown.last_mile_surcharge)} />
            )}
            {quote.breakdown.risky_zone_surcharge > 0 && (
              <BreakdownRow label="⚠️ Recargo zona peligrosa" value={formatCurrencyARS(quote.breakdown.risky_zone_surcharge)} />
            )}
            {quote.breakdown.shipment_multiplier !== 1 && (
              <BreakdownRow
                label="Tipo de envío (express)"
                value={formatCurrencyARS((quote.breakdown.base_fare + quote.breakdown.distance_cost) * (quote.breakdown.shipment_multiplier - 1))}
              />
            )}
            {quote.breakdown.time_window_surplus > 0 && (
              <BreakdownRow label="Recargo ventana horaria" value={formatCurrencyARS(quote.breakdown.time_window_surplus)} />
            )}
            {quote.breakdown.fragile_surplus > 0 && (
              <BreakdownRow label="Recargo frágil" value={formatCurrencyARS(quote.breakdown.fragile_surplus)} />
            )}
          </div>
        </>
      )}
    </GradientCard>
  );
}

function BreakdownRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-white/75">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function CustomerSuggestion({ customer, onApply, onDismiss }: { customer: Customer; onApply: () => void; onDismiss: () => void }) {
  return (
    <div className="absolute top-[calc(100%+4px)] left-0 right-0 z-50 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 flex items-center justify-between gap-3 shadow-lg">
      <div className="text-sm text-blue-900 leading-relaxed min-w-0 flex-1">
        <span className="font-bold">{customer.name}</span>
        <span className="mx-1.5 text-slate-400">·</span>
        <span>{customer.phone}</span>
        {customer.address.city && (
          <>
            <span className="mx-1.5 text-slate-400">·</span>
            <span>{customer.address.city}, {customer.address.province}</span>
          </>
        )}
      </div>
      <div className="flex gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onApply}
          className="h-7 px-3 rounded-md bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs font-semibold cursor-pointer"
        >
          Usar datos
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Descartar"
          className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:text-slate-700 hover:bg-slate-50 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function Section({ title, subtitle, children, icon }: { title: string; subtitle?: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex items-start gap-2 border-b border-slate-100">
        {icon && <span className="text-slate-500 mt-0.5">{icon}</span>}
        <div>
          <CardTitle>{title}</CardTitle>
          {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 pt-4">{children}</CardContent>
    </Card>
  );
}

function Row2({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  return <div className={`grid gap-3 ${isMobile ? "grid-cols-1" : "grid-cols-2"}`}>{children}</div>;
}

function Field({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
  return (
    <div className="grid gap-1.5">
      {label && (
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-semibold text-slate-700">{label}</label>
          {error && <span className="text-[11px] font-medium text-red-500 leading-tight">{error}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

const input: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #e2e8f0",
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
  background: "#fff",
  outline: "none",
  transition: "border-color 0.15s, box-shadow 0.15s",
};
