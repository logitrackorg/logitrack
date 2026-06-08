import { useEffect, useRef, useState } from "react";
import { Loader2, Check, Tag, AlertCircle, Info, X } from "lucide-react";
import type { SaveDraftPayload } from "../../../api/shipments";
import { shipmentApi } from "../../../api/shipments";
import type { Branch } from "../../../api/branches";
import type { Customer } from "../../../api/customers";
import { customerApi } from "../../../api/customers";
import { pricingApi, formatCurrencyARS, type QuoteResponse } from "../../../api/pricing";
import { GradientCard, GradientCardIcon, GradientCardLabel, GradientCardValue } from "../../../components/ui/gradient-card";
import { Button } from "../../../components/ui/button";
import { useIsMobile } from "../../../hooks/useIsMobile";
import { useAuth } from "../../../context/AuthContext";
import { findFinalBranch } from "../../../utils/geo";
import { extractErrorMessage } from "../../../utils/errors";
import { AddressAutocomplete } from "../../../components/AddressAutocomplete";
import { PROVINCES, PACKAGE_TYPES, SHIPMENT_TYPES, TIME_WINDOWS, DELIVERY_METHODS } from "../../../constants";

const fsClass = "border border-[var(--border)] rounded-xl p-3.5";
const legClass = "font-bold text-[13px] text-[var(--text-heading)] px-1.5";
const inpClass = "px-2.5 py-1.5 rounded-md border border-[var(--border-strong)] text-[13px] w-full box-border";

function CustomerSuggestion({ customer, onApply, onDismiss }: { customer: Customer; onApply: () => void; onDismiss: () => void }) {
  return (
    <div className="absolute top-[calc(100%+4px)] left-0 right-0 z-50 border border-[var(--brand-tint-border)] bg-[var(--brand-tint)] rounded-lg p-2.5 flex justify-between items-center gap-3 shadow-[0_4px_12px_rgba(0,0,0,0.1)]">
      <div className="text-[13px] text-blue-600 dark:text-blue-400 leading-relaxed min-w-0">
        <span className="font-bold">{customer.name}</span>
        <span className="text-[var(--text-secondary)] mx-1.5">·</span>
        <span>{customer.phone}</span>
        {customer.address.city && (
          <>
            <span className="text-[var(--text-secondary)] mx-1.5">·</span>
            <span>{customer.address.city}, {customer.address.province}</span>
          </>
        )}
      </div>
      <div className="flex gap-1.5 shrink-0">
        <button type="button" onClick={onApply}
          className="bg-blue-600 dark:bg-blue-500 text-white border-none rounded-md px-3 py-1.5 cursor-pointer text-xs font-semibold">
          Usar datos
        </button>
        <button type="button" onClick={onDismiss}
          className="bg-transparent text-[var(--text-secondary)] border border-[var(--border-strong)] rounded-md px-2.5 py-1.5 cursor-pointer text-xs">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

function DField({ label, children, style, className, error }: { label: string; children: React.ReactNode; style?: React.CSSProperties; className?: string; error?: string }) {
  return (
    <div className={`grid gap-1 relative ${className ?? ""}`} style={style}>
      {label && (
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-semibold text-[var(--text-strong)]">{label}</label>
          {error && <span className="text-[11px] font-medium text-[var(--danger-c)] leading-tight">{error}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

export function DraftEditForm({ form, onChange, onConfirm, onDiscard, confirming, confirmError, createdAt, draftId, branches }: {
  form: SaveDraftPayload;
  onChange: (f: SaveDraftPayload) => void;
  onConfirm: () => void;
  onDiscard: () => void;
  confirming: boolean;
  confirmError: string;
  createdAt: string;
  draftId: string;
  branches: Branch[];
}) {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const branchLocked = (user?.role === "operator" || user?.role === "supervisor") && !!user?.branch_id;
  const [discardConfirm, setDiscardConfirm] = useState(false);

  type AutoSaveStatus = "idle" | "saving" | "saved" | "error";
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>("idle");
  const [autoSaveError, setAutoSaveError] = useState("");
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      setAutoSaveStatus("saving");
      setAutoSaveError("");
      try {
        await shipmentApi.updateDraft(draftId, form);
        setAutoSaveStatus("saved");
      } catch (err: unknown) {
        const msg = extractErrorMessage(err);
        setAutoSaveError(msg ?? "No se pudieron guardar los cambios.");
        setAutoSaveStatus("error");
      }
    }, 1000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);
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
  const [senderNameError, setSenderNameError] = useState("");
  const [recipientNameError, setRecipientNameError] = useState("");
  const senderDNITimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recipientDNITimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const weightKg = form.weight_kg ?? 0;
    const packageType = form.package_type ?? "box";
    const selectedBranch = branches.find((b) => b.id === form.receiving_branch_id);
    const originAddress = selectedBranch
      ? { street: selectedBranch.address.street, city: selectedBranch.address.city, province: selectedBranch.province, postal_code: selectedBranch.address.postal_code, latitude: selectedBranch.latitude, longitude: selectedBranch.longitude }
      : form.sender.address;
    const finalBranch = findFinalBranch(form.recipient.address, branches);
    const destinationAddress = finalBranch
      ? { street: finalBranch.address.street, city: finalBranch.address.city, province: finalBranch.province, postal_code: finalBranch.address.postal_code, latitude: finalBranch.latitude, longitude: finalBranch.longitude }
      : form.recipient.address;
    const hasMinData =
      weightKg > 0 &&
      !!form.package_type &&
      !!originAddress.province &&
      !!destinationAddress.province;
    if (!hasMinData) { setQuote(null); return; }
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    quoteTimer.current = setTimeout(async () => {
      setQuoteLoading(true);
      try {
        const q = await pricingApi.quote({
          weight_kg: weightKg,
          package_type: packageType,
          shipment_type: form.shipment_type ?? "normal",
          time_window: form.time_window ?? "flexible",
          is_fragile: form.is_fragile,
          delivery_method: form.delivery_method ?? "ultima_milla",
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
    return () => { if (quoteTimer.current) clearTimeout(quoteTimer.current); };
  }, [
    form.weight_kg, form.package_type, form.shipment_type,
    form.time_window, form.is_fragile, form.delivery_method,
    form.receiving_branch_id, form.sender.address, form.recipient.address,
    branches,
  ]);

  const reName = /^[a-zA-ZÀ-ÖØ-öø-ÿñÑ\s'-]+$/;
  const validateNameField = (name: string) =>
    name && !reName.test(name) ? "El nombre no puede contener números ni caracteres especiales" : "";

  const handleSenderName = (name: string) => {
    setSender("name", name);
    setSenderNameError(validateNameField(name));
  };
  const handleRecipientName = (name: string) => {
    setRecipient("name", name);
    setRecipientNameError(validateNameField(name));
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
    onChange({
      ...form,
      sender: {
        ...form.sender,
        name: senderSuggestion.name,
        phone: (senderSuggestion.phone ?? "").replace(/\D/g, ""),
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

  const envelopeOverweight = (form.package_type ?? "box") === "envelope" && (form.weight_kg ?? 0) > 5;

  const applyRecipientSuggestion = () => {
    if (!recipientSuggestion) return;
    onChange({
      ...form,
      recipient: {
        ...form.recipient,
        name: recipientSuggestion.name,
        phone: (recipientSuggestion.phone ?? "").replace(/\D/g, ""),
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
    <div className="grid gap-4 mb-4">
      <div className="flex gap-5 text-[13px] text-[var(--text-secondary)]">
        <span>Creado: {createdAt}</span>
        <span>ID del borrador: <code className="bg-[var(--bg-muted)] px-1.5 py-0.5 rounded text-xs text-[var(--text-strong)]">{draftId}</code></span>
      </div>

      {/* Remitente */}
      <fieldset className={fsClass}>
        <legend className={legClass}>Remitente</legend>
        <div className={`grid ${isMobile ? "grid-cols-1" : "grid-cols-2"} gap-2.5`}>
          <DField label="Nombre *">
            <input className={`${inpClass} ${senderNameError ? "border-[var(--danger-c)]" : ""}`} required value={form.sender.name ?? ""} onChange={(e) => handleSenderName(e.target.value)} placeholder="Carlos Mendez" />
            {senderNameError && <span className="text-red-600 dark:text-red-400 text-xs">{senderNameError}</span>}
          </DField>
          <DField label="Teléfono *"><input className={inpClass} required value={form.sender.phone ?? ""} onChange={(e) => setSender("phone", e.target.value.replace(/\D/g, ""))} placeholder="5491112345678" /></DField>
          <DField label="Email"><input className={inpClass} type="email" value={form.sender.email ?? ""} onChange={(e) => setSender("email", e.target.value)} placeholder="opcional" /></DField>
          <DField label="DNI *">
            <input className={inpClass} required value={form.sender.dni ?? ""} onChange={(e) => handleSenderDNI(e.target.value)} placeholder="ej: 30123456" />
            {senderSuggestion && <CustomerSuggestion customer={senderSuggestion} onApply={applySenderSuggestion} onDismiss={() => setSenderSuggestion(null)} />}
          </DField>
          <DField label="Calle *">
            <AddressAutocomplete className={inpClass} required value={form.sender.address.street ?? ""}
              onChange={(v) => setSenderAddr("street", v)}
              onAddressSelect={(p) => onChange({ ...form, sender: { ...form.sender, address: { ...form.sender.address, ...(p.street && { street: p.street }), ...(p.city && { city: p.city }), ...(p.province && { province: p.province }), ...(p.postal_code && { postal_code: p.postal_code }) } } })}
              placeholder="Av. Corrientes 1234, Buenos Aires" />
          </DField>
          <DField label="Ciudad *"><input className={inpClass} required value={form.sender.address.city ?? ""} onChange={(e) => setSenderAddr("city", e.target.value)} placeholder="Buenos Aires" /></DField>
          <DField label="Provincia *">
            <select className={inpClass} required value={form.sender.address.province ?? ""} onChange={(e) => setSenderAddr("province", e.target.value)}>
              <option value="">Seleccionar</option>
              {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </DField>
          <DField label="Código postal *"><input className={inpClass} required value={form.sender.address.postal_code ?? ""} onChange={(e) => setSenderAddr("postal_code", e.target.value)} placeholder="C1043" /></DField>
        </div>
      </fieldset>

      {/* Destinatario */}
      <fieldset className={fsClass}>
        <legend className={legClass}>Destinatario</legend>
        <div className={`grid ${isMobile ? "grid-cols-1" : "grid-cols-2"} gap-2.5`}>
          <DField label="Nombre *">
            <input className={`${inpClass} ${recipientNameError ? "border-[var(--danger-c)]" : ""}`} required value={form.recipient.name ?? ""} onChange={(e) => handleRecipientName(e.target.value)} placeholder="Laura Gomez" />
            {recipientNameError && <span className="text-red-600 dark:text-red-400 text-xs">{recipientNameError}</span>}
          </DField>
          <DField label="Teléfono *"><input className={inpClass} required value={form.recipient.phone ?? ""} onChange={(e) => setRecipient("phone", e.target.value.replace(/\D/g, ""))} placeholder="5493516784321" /></DField>
          <DField label="Email"><input className={inpClass} type="email" value={form.recipient.email ?? ""} onChange={(e) => setRecipient("email", e.target.value)} placeholder="opcional" /></DField>
          <DField label="DNI *">
            <input className={inpClass} required value={form.recipient.dni ?? ""} onChange={(e) => handleRecipientDNI(e.target.value)} placeholder="ej: 28456789" />
            {recipientSuggestion && <CustomerSuggestion customer={recipientSuggestion} onApply={applyRecipientSuggestion} onDismiss={() => setRecipientSuggestion(null)} />}
          </DField>
          <DField label="Calle *">
            <AddressAutocomplete className={inpClass} required value={form.recipient.address.street ?? ""}
              onChange={(v) => setRecipientAddr("street", v)}
              onAddressSelect={(p) => onChange({ ...form, recipient: { ...form.recipient, address: { ...form.recipient.address, ...(p.street && { street: p.street }), ...(p.city && { city: p.city }), ...(p.province && { province: p.province }), ...(p.postal_code && { postal_code: p.postal_code }) } } })}
              placeholder="San Martín 456, Córdoba" />
          </DField>
          <DField label="Ciudad *"><input className={inpClass} required value={form.recipient.address.city ?? ""} onChange={(e) => setRecipientAddr("city", e.target.value)} placeholder="Córdoba" /></DField>
          <DField label="Provincia *">
            <select className={inpClass} required value={form.recipient.address.province ?? ""} onChange={(e) => setRecipientAddr("province", e.target.value)}>
              <option value="">Seleccionar</option>
              {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </DField>
          <DField label="Código postal *"><input className={inpClass} required value={form.recipient.address.postal_code ?? ""} onChange={(e) => setRecipientAddr("postal_code", e.target.value)} placeholder="X5000" /></DField>
        </div>
        {(form.recipient.name || form.recipient.dni) && (
          <div className="mt-2.5 px-3.5 py-2.5 rounded-lg border border-[var(--info-border)] bg-[var(--bg-hover)] flex gap-2.5 items-start">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="text-xs text-[var(--info)] m-0 leading-relaxed">
              Los datos personales del destinatario se conservarán según la política de retención de borradores vigente y serán tratados conforme a la{" "}
              <strong>Ley 25.326 de Protección de Datos Personales</strong>.{" "}
              Si el borrador no se confirma, los datos serán eliminados automáticamente pasado el período de vigencia.
            </p>
          </div>
        )}
      </fieldset>

      {/* Sucursales */}
      <fieldset className={fsClass}>
        <legend className={legClass}>Sucursales</legend>
        <div className="grid gap-3">
          <div>
            <div className="text-[11px] font-semibold text-[var(--text-strong)] mb-1.5">Sucursal de origen *</div>
            {branchLocked ? (() => {
              const selected = branches.find(b => b.id === form.receiving_branch_id);
              return (
                <div className="border border-[var(--brand-tint-border)] bg-[var(--brand-tint)] rounded-lg p-2.5">
                  <div className="text-[13px] font-semibold text-[var(--text-heading)]">{selected?.name ?? form.receiving_branch_id ?? "—"}</div>
                  {selected && <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">{selected.address.street}, {selected.address.city}</div>}
                  <div className="text-[10px] text-[var(--text-secondary)] mt-1.5">Asignada a tu sucursal — no se puede cambiar.</div>
                </div>
              );
            })() : (() => {
              const selected = branches.find(b => b.id === form.receiving_branch_id);
              return selected ? (
                <div className="border border-[var(--brand-tint-border)] bg-[var(--brand-tint)] rounded-lg p-2.5">
                  <div className="text-[13px] font-semibold text-[var(--text-heading)]">{selected.name}</div>
                  <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">{selected.address.street}, {selected.address.city}</div>
                </div>
              ) : (
                <div className="text-xs text-[var(--text-muted)]">Sin sucursal asignada</div>
              );
            })()}
          </div>
          {(() => {
            const finalBranch = findFinalBranch(form.recipient.address, branches);
            if (!finalBranch) return null;
            return (
              <div>
                <div className="text-[11px] font-semibold text-[var(--text-strong)] mb-1.5">Sucursal final</div>
                <div className="border border-[var(--ok-border)] bg-[var(--ok-bg)] rounded-lg p-2.5">
                  <div className="text-[13px] font-semibold text-[var(--text-heading)]">{finalBranch.name}</div>
                  <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">{finalBranch.address.street}, {finalBranch.address.city}</div>
                  <div className="text-[10px] text-[var(--text-secondary)] mt-1.5">Sucursal más cercana al domicilio del destinatario.</div>
                </div>
              </div>
            );
          })()}
        </div>
      </fieldset>

      {/* Paquete */}
      <fieldset className={fsClass}>
        <legend className={legClass}>Paquete</legend>
        <div className={`grid ${isMobile ? "grid-cols-1" : "grid-cols-2"} gap-2.5`}>
          <DField label="Peso (kg) *" error={envelopeOverweight ? "Un sobre no puede superar 5 kg; usá una caja" : undefined}>
            <input className={`${inpClass} ${envelopeOverweight ? "border-[var(--danger-c)]" : ""}`}
              type="number" step="0.1" min="0.1" required value={form.weight_kg || ""}
              onChange={(e) => set("weight_kg", parseFloat(e.target.value) || 0)} placeholder="3.5" />
          </DField>
          <DField label="Tipo de paquete *">
            <select className={inpClass} value={form.package_type ?? "box"} onChange={(e) => set("package_type", e.target.value)}>
              {PACKAGE_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </DField>
          <DField label="Tipo de envío">
            <select className={inpClass} value={form.shipment_type ?? "normal"} onChange={(e) => set("shipment_type", e.target.value)}>
              {SHIPMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </DField>
          <DField label="Ventana horaria">
            <select className={inpClass} value={form.time_window ?? "flexible"} onChange={(e) => set("time_window", e.target.value)}>
              {TIME_WINDOWS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </DField>
          <DField label="Método de entrega" className="col-span-full">
            <select className={inpClass} value={form.delivery_method ?? "ultima_milla"} onChange={(e) => set("delivery_method", e.target.value)}>
              {DELIVERY_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </DField>
          <DField label="" className="col-span-full">
            <div className="flex gap-5">
              <label className="flex items-center gap-2 cursor-pointer text-[13px]">
                <input type="checkbox" checked={!!form.is_fragile} onChange={(e) => set("is_fragile", e.target.checked)} />
                Contenido frágil (manipular con cuidado)
              </label>
            </div>
          </DField>
          <DField label="Instrucciones especiales" className="col-span-full">
            <input className={inpClass} value={form.special_instructions ?? ""} onChange={(e) => set("special_instructions", e.target.value)} placeholder='ej: "Mantener vertical"' />
          </DField>
        </div>
      </fieldset>

      {/* Cotización */}
      {(quote || quoteLoading) && (
        <GradientCard tone="brand">
          <div className="flex items-start gap-3 mb-3">
            <GradientCardIcon><Tag className="w-5 h-5" /></GradientCardIcon>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <GradientCardLabel>Cotización del envío</GradientCardLabel>
                {quoteLoading && <span className="text-[11px] text-white/70">Calculando…</span>}
              </div>
              {quote ? (
                <>
                  <GradientCardValue className="mt-1">{formatCurrencyARS(quote.total)}</GradientCardValue>
                  <p className="mt-1 text-[11px] text-white/60">Precio estimado. Se confirma al crear el envío.</p>
                </>
              ) : (
                <p className="mt-1 text-sm text-white/80">Completá peso, tipo de paquete y direcciones para ver la cotización.</p>
              )}
            </div>
          </div>
          {quote && (
            <>
              <div className="grid gap-1.5 text-xs pt-3 border-t border-white/15">
                <div className="flex justify-between items-center"><span className="text-white/75">Tarifa base</span><span className="font-semibold tabular-nums">{formatCurrencyARS(quote.breakdown.base_fare)}</span></div>
                <div className="flex justify-between items-center"><span className="text-white/75">Distancia ({quote.breakdown.distance_km.toFixed(1)} km)</span><span className="font-semibold tabular-nums">{formatCurrencyARS(quote.breakdown.distance_cost)}</span></div>
                {quote.breakdown.weight_surcharge > 0 && <div className="flex justify-between items-center"><span className="text-white/75">Recargo por peso</span><span className="font-semibold tabular-nums">{formatCurrencyARS(quote.breakdown.weight_surcharge)}</span></div>}
                {quote.breakdown.last_mile_surcharge > 0 && <div className="flex justify-between items-center"><span className="text-white/75">Entrega a domicilio</span><span className="font-semibold tabular-nums">{formatCurrencyARS(quote.breakdown.last_mile_surcharge)}</span></div>}
                {quote.breakdown.shipment_multiplier !== 1 && <div className="flex justify-between items-center"><span className="text-white/75">Tipo de envío (express)</span><span className="font-semibold tabular-nums">{formatCurrencyARS((quote.breakdown.base_fare + quote.breakdown.distance_cost) * (quote.breakdown.shipment_multiplier - 1))}</span></div>}
                {quote.breakdown.time_window_surplus > 0 && <div className="flex justify-between items-center"><span className="text-white/75">Recargo ventana horaria</span><span className="font-semibold tabular-nums">{formatCurrencyARS(quote.breakdown.time_window_surplus)}</span></div>}
                {quote.breakdown.fragile_surplus > 0 && <div className="flex justify-between items-center"><span className="text-white/75">Recargo frágil</span><span className="font-semibold tabular-nums">{formatCurrencyARS(quote.breakdown.fragile_surplus)}</span></div>}
              </div>
            </>
          )}
        </GradientCard>
      )}

      {/* Acciones */}
      <div className="border border-[var(--warn-border)] bg-[var(--warn-bg)] rounded-xl px-[18px] py-3.5">
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <h2 className="text-base m-0 text-[var(--warn-text)]">Borrador — pendiente de confirmación</h2>
          {autoSaveStatus === "saving" && (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--warn-text)]">
              <Loader2 className="animate-spin w-3 h-3" />Guardando…
            </span>
          )}
          {autoSaveStatus === "saved" && (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--ok-text)]">
              <Check className="w-3 h-3" />Guardado automáticamente
            </span>
          )}
          {autoSaveStatus === "error" && (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--danger-text)]">
              <AlertCircle className="w-3 h-3" />{autoSaveError || "Error al guardar"}
            </span>
          )}
        </div>
        <p className="m-0 mb-3 text-[13px] text-[var(--warn-text)]">
          Los cambios se guardan automáticamente. Al continuar se generará el cobro y, una vez confirmado el pago, se asignará el número de seguimiento.
        </p>
        <p className="m-0 mb-3 text-[13px] text-[var(--warn-text)]">
          <strong>Entrega estimada:</strong> Se calculará al confirmar el envío.
        </p>
        {confirmError && <p className="text-[var(--danger-c)] m-0 mb-2 text-[13px]">{confirmError}</p>}
        {discardConfirm ? (
          <div className="bg-[var(--danger-bg)] border border-[var(--danger-border)] rounded-lg p-2.5 mb-2.5">
            <p className="m-0 mb-2.5 text-[13px] font-semibold text-[var(--danger-text)]">
              ¿Seguro que querés descartar este borrador? Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-2">
              <Button onClick={onDiscard} disabled={confirming} variant="destructive" size="sm">
                Sí, descartar
              </Button>
              <Button onClick={() => setDiscardConfirm(false)} variant="outline" size="sm">
                Cancelar
              </Button>
            </div>
          </div>
        ) : null}
        <div className="flex gap-2.5 flex-wrap">
          <Button onClick={onConfirm} disabled={confirming || envelopeOverweight}>
            {confirming ? "Procesando..." : "Continuar al pago"}
          </Button>
          <Button onClick={() => setDiscardConfirm(true)} disabled={confirming || discardConfirm} variant="outline" className="ml-auto">
            Descartar borrador
          </Button>
        </div>
      </div>
    </div>
  );
}
