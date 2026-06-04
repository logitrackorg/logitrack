import { useCallback, useEffect, useRef, useState } from "react";
import { paymentApi, type Payment } from "../api/payments";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Pencil, AlertTriangle, X, Undo2, Loader2, Check, Tag, AlertCircle, Truck, CreditCard, Info, MapPin, Printer, QrCode, Circle, Flag, ChevronDown } from "lucide-react";
import {
  shipmentApi,
  type Shipment,
  type ShipmentEvent,
  type ShipmentStatus,
  type SaveDraftPayload,
  type ShipmentComment,
  type ShipmentIncident,
  type IncidentType,
  INCIDENT_TYPE_LABELS,
  TERMINAL_INCIDENT_STATUS,
} from "../api/shipments";
import { CLAIM_EVENT_LABELS, type ClaimEventType } from "../api/claims";
import { usersApi, type UserProfile } from "../api/users";
import { vehicleApi, type VehicleStatusResponse } from "../api/vehicles";
import { VehicleDetailModal } from "./VehicleList";
import { StatusBadge } from "../components/StatusBadge";
import { PriorityBadge } from "../components/PriorityBadge";
import { ZoneBadge } from "../components/ZoneBadge";
import { shipmentStatusLabelOverride } from "../utils/shipmentStatus";
import { useAuth } from "../context/AuthContext";
import { branchApi, branchLabel, branchLabelById, type Branch, type BranchCapacity } from "../api/branches";
import { customerApi, type Customer } from "../api/customers";
import { pricingApi, formatCurrencyARS, type QuoteResponse } from "../api/pricing";
import { GradientCard, GradientCardIcon, GradientCardLabel, GradientCardValue } from "../components/ui/gradient-card";
import { Button } from "../components/ui/button";
import { fmtDate, fmtDateTime } from "../utils/date";
import { useIsMobile } from "../hooks/useIsMobile";
import ShipmentQRModal from '../components/ShipmentQRModal';
import PaymentMethodsPanel from '../components/PaymentMethodsPanel';
import { qrService, type QRResponse } from '../api/qrService';
import { printShipmentDocument } from '../utils/printShipmentDocument';
import { organizationApi, type OrganizationConfig } from '../api/organizationApi';
import { systemConfigApi } from '../api/systemConfig';
import { tripsApi, type InterBranchTrip } from '../api/routing';
import { AddressAutocomplete } from '../components/AddressAutocomplete';

const TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  draft:                [],
  at_origin_hub:        ["loaded", "ready_for_return"],
  loaded:               [],
  in_transit:           [],
  at_hub:               ["loaded", "out_for_delivery", "ready_for_pickup"],
  out_for_delivery:     ["delivered", "delivery_failed"],
  delivery_failed:      ["redelivery_scheduled", "ready_for_pickup", "rechazado"],
  redelivery_scheduled: ["out_for_delivery"],
  no_entregado:         [],
  rechazado:            [],
  delivered:            [],
  ready_for_pickup:     ["delivered", "no_entregado"],
  ready_for_return:     ["returned"],
  returned:             [],
  cancelled:            [],
  lost:                 [],
  destroyed:            [],
  expired:              [],
  pending_payment:      [],
};

const STATUS_LABELS: Record<ShipmentStatus, string> = {
  draft:                "Borrador",
  at_origin_hub:        "En sucursal de origen",
  loaded:               "Cargado en vehículo",
  in_transit:           "En tránsito",
  at_hub:               "En sucursal",
  out_for_delivery:     "Última milla",
  delivery_failed:      "Entrega fallida",
  redelivery_scheduled: "Reentrega programada",
  no_entregado:         "No entregado",
  rechazado:            "Rechazado",
  delivered:            "Entregado",
  ready_for_pickup:     "Listo para retiro",
  ready_for_return:     "Listo para devolución",
  returned:             "Devuelto",
  cancelled:            "Cancelado",
  lost:                 "Extraviado",
  destroyed:            "Daño total",
  expired:              "Borrador expirado",
  pending_payment:      "Pago pendiente",
};

const PACKAGE_LABELS: Record<string, string> = {
  envelope: "Sobre", box: "Caja",
};

const formatShipmentEventLabel = (ev: ShipmentEvent) => {
  const claimEventType = ev.event_type as ClaimEventType | undefined;
  if (claimEventType && claimEventType in CLAIM_EVENT_LABELS) {
    return CLAIM_EVENT_LABELS[claimEventType];
  }

  if (ev.event_type === "incident_reported") {
    return "Incidencia reportada";
  }

  if (ev.event_type === "edited") {
    return STATUS_LABELS[ev.to_status];
  }

  if (ev.from_status) {
    return `${STATUS_LABELS[ev.from_status]} → ${STATUS_LABELS[ev.to_status]}`;
  }

  return ev.to_status ? STATUS_LABELS[ev.to_status] : "Evento registrado";
};

export function ShipmentDetail() {
  const { hasRole, user } = useAuth();
  const isMobile = useIsMobile();
  const { trackingId } = useParams<{ trackingId: string }>();
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [events, setEvents] = useState<ShipmentEvent[]>([]);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [drivers, setDrivers] = useState<UserProfile[]>([]);
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
  const [comments, setComments] = useState<ShipmentComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [addingComment, setAddingComment] = useState(false);
  const [incidents, setIncidents] = useState<ShipmentIncident[]>([]);
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [incidentType, setIncidentType] = useState<IncidentType>("extraviado");
  const [incidentDescription, setIncidentDescription] = useState("");
  const [reportingIncident, setReportingIncident] = useState(false);
  const [incidentError, setIncidentError] = useState("");
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [correctionForm, setCorrectionForm] = useState<Record<string, string>>({});
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [correctionError, setCorrectionError] = useState("");
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [assignedVehicle, setAssignedVehicle] = useState<VehicleStatusResponse | null>(null);
  const [loadingVehicle, setLoadingVehicle] = useState(false);
  const [showVehicleDetail, setShowVehicleDetail] = useState(false);
  // Vehicle picker for loaded
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);
  const [availableVehicles, setAvailableVehicles] = useState<import("../api/vehicles").Vehicle[]>([]);
  const [loadingVehicles, setLoadingVehicles] = useState(false);
  const [selectedVehiclePlate, setSelectedVehiclePlate] = useState("");
  const [assigningVehicle, setAssigningVehicle] = useState(false);
  const [vehiclePickerError, setVehiclePickerError] = useState("");

  //  Estados para QR
  const [qrData, setQRData] = useState<QRResponse | null>(null);
  const [showQRModal, setShowQRModal] = useState(false);
  const [qrError, setQRError] = useState<string>('');
  const [generatingQR, setGeneratingQR] = useState(false);
  const [moving, setMoving] = useState(false);

  // Estados para impresión de alta
  const [printingDoc, setPrintingDoc] = useState(false);
  const [printDocError, setPrintDocError] = useState('');
  const [orgConfig, setOrgConfig] = useState<OrganizationConfig | null>(null);
  const [maxDeliveryAttempts, setMaxDeliveryAttempts] = useState(3);
  const [branchCapacity, setBranchCapacity] = useState<BranchCapacity | null>(null);
  const [reservedTrip, setReservedTrip] = useState<InterBranchTrip | null>(null);

  const reload = useCallback(async () => {
    if (!trackingId) return;
    try {
      const [s, ev, cmts, incs] = await Promise.all([
        shipmentApi.get(trackingId),
        shipmentApi.getEvents(trackingId),
        shipmentApi.getComments(trackingId),
        shipmentApi.getIncidents(trackingId),
      ]);
      setShipment(s);
      setEvents(ev ?? []);
      setComments(cmts ?? []);
      setIncidents(incs ?? []);
      setNewStatus("");
      if (s.status === "draft") {
        setDraftForm({
          sender: { ...s.sender, phone: (s.sender.phone ?? "").replace(/\D/g, "") },
          recipient: { ...s.recipient, phone: (s.recipient.phone ?? "").replace(/\D/g, "") },
          weight_kg: s.weight_kg ?? 0,
          package_type: s.package_type ?? "box",
          is_fragile: s.is_fragile ?? false,
          special_instructions: s.special_instructions ?? "",
          shipment_type: s.shipment_type ?? "normal",
          time_window: s.time_window ?? "flexible",
          receiving_branch_id: s.receiving_branch_id ?? "",
          delivery_method: s.delivery_method ?? "ultima_milla",
        });
      }
    } catch {
      setError("Envío no encontrado.");
    }
  }, [trackingId]);

  const loadAssignedVehicle = async (tid: string) => {
    setLoadingVehicle(true);
    try {
      const v = await vehicleApi.getByShipment(tid);
      setAssignedVehicle(v);
    } catch {
      setAssignedVehicle(null);
    } finally {
      setLoadingVehicle(false);
    }
  };

  const effectiveWeightKg = (s: Shipment): number => {
    const corrected = s.corrections?.weight_kg;
    if (corrected !== undefined) {
      const parsed = parseFloat(corrected);
      if (!isNaN(parsed)) return parsed;
    }
    return s.weight_kg ?? 0;
  };

  const openVehiclePicker = async (s: Shipment) => {
    setVehiclePickerError("");
    setSelectedVehiclePlate("");
    setShowVehiclePicker(true);
    setLoadingVehicles(true);
    try {
      // Determine which branch the shipment is currently at
      const branchId = (s.status === "at_hub" || s.status === "ready_for_pickup")
        ? s.current_location
        : s.receiving_branch_id;
      const vehicles = await vehicleApi.listAvailable({ branch_id: branchId ?? undefined });
      // Filter by available remaining capacity
      const eligible = vehicles.filter(v => {
        const usedKg = 0;
        return v.capacity_kg - usedKg >= effectiveWeightKg(s);
      });
      setAvailableVehicles(eligible);
    } catch {
      setVehiclePickerError("No se pudieron cargar los vehículos disponibles.");
    } finally {
      setLoadingVehicles(false);
    }
  };

  const handleAssignVehicle = async () => {
    if (!selectedVehiclePlate || !trackingId) return;
    setAssigningVehicle(true);
    setVehiclePickerError("");
    try {
      const vehicle = await vehicleApi.assignToShipment(selectedVehiclePlate, { tracking_id: trackingId });
      setAssignedVehicle(vehicle);
      setShowVehiclePicker(false);
      setNewStatus("");
      await reload();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setVehiclePickerError(msg ?? "No se pudo asignar el vehículo.");
    } finally {
      setAssigningVehicle(false);
    }
  };

    // Función para generar QR
  const handleGenerateQR = async () => {
    if (!trackingId) return;

    try {
      setQRError('');
      setGeneratingQR(true);
      const data = await qrService.generateQR(trackingId);
      setQRData(data);
      setShowQRModal(true);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Error al generar código QR';
      setQRError(message);
    } finally {
      setGeneratingQR(false);
    }
  };

  // Función para imprimir el alta del envío (CA-1, CA-2, CA-3, CA-4)
  const handlePrintDocument = async () => {
    if (!shipment) return;
    // CA-3: solo envíos confirmados con tracking ID asignado
    if (!shipment.tracking_id.startsWith('LT-')) {
      setPrintDocError('El documento solo puede generarse para envíos confirmados con tracking ID asignado.');
      return;
    }
    try {
      setPrintDocError('');
      setPrintingDoc(true);
      const qr = await qrService.generateQR(shipment.tracking_id);
      printShipmentDocument(shipment, branches, qr.qr_code_base64, orgConfig);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Error al generar el documento de impresión';
      setPrintDocError(message);
    } finally {
      setPrintingDoc(false);
    }
  };

  useEffect(() => {
    reload();
    if (trackingId) loadAssignedVehicle(trackingId);
    branchApi.list().then(setBranches);
    organizationApi.get().then(setOrgConfig).catch(() => {});
    systemConfigApi.get().then((cfg) => setMaxDeliveryAttempts(cfg.max_delivery_attempts)).catch(() => {});
  }, [trackingId, reload]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { trackingId: tid } = (e as CustomEvent).detail ?? {};
      if (tid && tid === trackingId) reload();
    };
    window.addEventListener('chatbot:pickup-success', handler);
    return () => window.removeEventListener('chatbot:pickup-success', handler);
  }, [trackingId, reload]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { trackingId: tid } = (e as CustomEvent).detail ?? {};
      if (tid && tid === trackingId) reload();
    };
    window.addEventListener('chatbot:cancel-success', handler);
    return () => window.removeEventListener('chatbot:cancel-success', handler);
  }, [trackingId, reload]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { trackingId: tid } = (e as CustomEvent).detail ?? {};
      if (tid && tid === trackingId) reload();
    };
    window.addEventListener('chatbot:reschedule-success', handler);
    return () => window.removeEventListener('chatbot:reschedule-success', handler);
  }, [trackingId, reload]);

  useEffect(() => {
    if (shipment?.status === "draft" && shipment.receiving_branch_id) {
      branchApi.getCapacity(shipment.receiving_branch_id).then(setBranchCapacity).catch(() => {});
    } else {
      setBranchCapacity(null);
    }
  }, [shipment?.status, shipment?.receiving_branch_id]);

  useEffect(() => {
    if (shipment?.reserved_for_trip_id) {
      tripsApi.getByID(shipment.reserved_for_trip_id).then(setReservedTrip).catch(() => setReservedTrip(null));
    } else {
      setReservedTrip(null);
    }
  }, [shipment?.reserved_for_trip_id]);

  const handleConfirmDraft = async () => {
    if (!trackingId || !draftForm) return;
    if (!draftForm.sender.name) { setConfirmError("El nombre del remitente es obligatorio."); return; }
    if (!draftForm.sender.phone) { setConfirmError("El teléfono del remitente es obligatorio."); return; }
    if (!draftForm.sender.dni || draftForm.sender.dni.length < 7) { setConfirmError("El DNI del remitente debe tener al menos 7 dígitos."); return; }
    if (!draftForm.sender.address.street) { setConfirmError("La calle del remitente es obligatoria."); return; }
    if (!draftForm.sender.address.city) { setConfirmError("La ciudad del remitente es obligatoria."); return; }
    if (/^\d+$/.test(draftForm.sender.address.city)) { setConfirmError("La ciudad del remitente no puede contener solo números."); return; }
    if (!draftForm.sender.address.province) { setConfirmError("La provincia del remitente es obligatoria."); return; }
    if (!draftForm.sender.address.postal_code) { setConfirmError("El código postal del remitente es obligatorio."); return; }
    if (/^[a-zA-Z]+$/.test(draftForm.sender.address.postal_code)) { setConfirmError("El código postal del remitente debe contener al menos un dígito."); return; }
    if (!draftForm.recipient.name) { setConfirmError("El nombre del destinatario es obligatorio."); return; }
    if (!draftForm.recipient.phone) { setConfirmError("El teléfono del destinatario es obligatorio."); return; }
    if (!draftForm.recipient.dni || draftForm.recipient.dni.length < 7) { setConfirmError("El DNI del destinatario debe tener al menos 7 dígitos."); return; }
    if (!draftForm.recipient.address.street) { setConfirmError("La calle del destinatario es obligatoria."); return; }
    if (!draftForm.recipient.address.city) { setConfirmError("La ciudad del destinatario es obligatoria."); return; }
    if (/^\d+$/.test(draftForm.recipient.address.city)) { setConfirmError("La ciudad del destinatario no puede contener solo números."); return; }
    if (!draftForm.recipient.address.province) { setConfirmError("La provincia del destinatario es obligatoria."); return; }
    if (!draftForm.recipient.address.postal_code) { setConfirmError("El código postal del destinatario es obligatorio."); return; }
    if (/^[a-zA-Z]+$/.test(draftForm.recipient.address.postal_code)) { setConfirmError("El código postal del destinatario debe contener al menos un dígito."); return; }
    if (!draftForm.weight_kg || draftForm.weight_kg <= 0) { setConfirmError("El peso debe ser mayor a 0."); return; }
    setConfirming(true);
    setConfirmError("");
    try {
      await shipmentApi.updateDraft(trackingId, draftForm);
      await paymentApi.requestPayment(trackingId);
      setShipment(s => s ? { ...s, status: "pending_payment" as ShipmentStatus } : s);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setConfirmError(msg ?? "No se pudo iniciar el pago del envío.");
    } finally {
      setConfirming(false);
    }
  };

  const handleDiscardDraft = async () => {
    if (!trackingId) return;
    try {
      await shipmentApi.cancelShipment(trackingId, "Borrador descartado por el usuario");
      navigate("/drafts", { replace: true });
    } catch {
      // silently ignore — navigate away anyway if draft is gone
      navigate("/drafts", { replace: true });
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
        driver_id: newStatus === "out_for_delivery" ? selectedDriverId : undefined,
        recipient_dni: newStatus === "delivered" || (newStatus === "returned" && !!shipment?.parent_shipment_id) ? recipientDni : undefined,
        sender_dni: newStatus === "returned" && !shipment?.parent_shipment_id ? senderDni : undefined,
      });
      setLocation(""); setNotes(""); setSelectedDriverId(""); setRecipientDni(""); setSenderDni("");
      await reload();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setUpdateError(msg ?? "No se pudo actualizar el estado.");
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
      special_instructions: c.special_instructions ?? shipment.special_instructions ?? "",
      time_window: c.time_window ?? shipment.time_window ?? "flexible",
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
      special_instructions: c.special_instructions ?? shipment.special_instructions ?? "",
      time_window: c.time_window ?? shipment.time_window ?? "flexible",
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
    const required: Array<[string, string]> = [
      ["sender_name", "Nombre del remitente"],
      ["sender_phone", "Teléfono del remitente"],
      ["sender_dni", "DNI del remitente"],
      ["origin_street", "Calle del remitente"],
      ["origin_city", "Ciudad del remitente"],
      ["origin_province", "Provincia del remitente"],
      ["origin_postal_code", "Código postal del remitente"],
      ["recipient_name", "Nombre del destinatario"],
      ["recipient_phone", "Teléfono del destinatario"],
      ["recipient_dni", "DNI del destinatario"],
      ["destination_street", "Calle del destinatario"],
      ["destination_city", "Ciudad del destinatario"],
      ["destination_province", "Provincia del destinatario"],
      ["destination_postal_code", "Código postal del destinatario"],
    ];
    for (const [key, label] of required) {
      if (!correctionForm[key]?.trim()) { setCorrectionError(`${label} es obligatorio.`); return; }
    }
    if (changed.sender_dni !== undefined && changed.sender_dni.length < 7) { setCorrectionError("El DNI del remitente debe tener al menos 7 dígitos."); return; }
    if (changed.recipient_dni !== undefined && changed.recipient_dni.length < 7) { setCorrectionError("El DNI del destinatario debe tener al menos 7 dígitos."); return; }
    if (/^\d+$/.test(correctionForm.origin_city ?? "")) { setCorrectionError("La ciudad del remitente no puede contener solo números."); return; }
    if (/^\d+$/.test(correctionForm.destination_city ?? "")) { setCorrectionError("La ciudad del destinatario no puede contener solo números."); return; }
    if (/^[a-zA-Z]+$/.test(correctionForm.origin_postal_code ?? "")) { setCorrectionError("El código postal del remitente debe contener al menos un dígito."); return; }
    if (/^[a-zA-Z]+$/.test(correctionForm.destination_postal_code ?? "")) { setCorrectionError("El código postal del destinatario debe contener al menos un dígito."); return; }
    setSavingCorrection(true);
    setCorrectionError("");
    try {
      await shipmentApi.correctShipment(trackingId, changed);
      setShowCorrectionModal(false);
      await reload();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setCorrectionError(msg ?? "No se pudieron guardar las correcciones.");
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
      setCancelError(msg ?? "No se pudo cancelar el envío.");
    } finally {
      setCancelling(false);
    }
  };

  if (error) return (
    <div className="p-6">
      <p className="text-[var(--danger-text)]">{error}</p>
      <Button variant="outline" onClick={() => navigate("/")} className="mt-2">
        <ArrowLeft className="w-4 h-4" /> Volver al listado
      </Button>
    </div>
  );

  if (!shipment) return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="animate-pulse space-y-6">
        <div className="flex items-center gap-4">
          <div className="h-8 w-48 bg-slate-200 rounded" />
          <div className="h-6 w-24 bg-slate-200 rounded-full" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="h-48 bg-slate-200 rounded-lg" />
            <div className="h-32 bg-slate-200 rounded-lg" />
          </div>
          <div className="space-y-4">
            <div className="h-40 bg-slate-200 rounded-lg" />
            <div className="h-24 bg-slate-200 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );

  const isAtOriginBranch = shipment.current_location === shipment.receiving_branch_id;
  const isAtDestinationBranch = shipment.status === "at_hub" && shipment.current_location === shipment.final_branch_id;
  const deliveryMethod = shipment.delivery_method ?? "ultima_milla";
  const nextStatuses = TRANSITIONS[shipment.status].filter(
    (s) => s !== "ready_for_return" || (shipment.is_returning && isAtOriginBranch)
  ).filter(
    (s) => !shipment.is_returning || (s !== "out_for_delivery" && s !== "ready_for_pickup")
  ).filter(
    () => !(hasRole("operator", "supervisor") && shipment.status === "out_for_delivery")
  ).filter(
    // out_for_delivery solo puede asignarse por el sistema de reparto (plan → vehículo → QR).
    // Operadores y supervisores no pueden dispararlo manualmente.
    (s) => !(hasRole("operator", "supervisor") && s === "out_for_delivery")
  ).filter(
    (s) => s !== "redelivery_scheduled" || (shipment.delivery_attempts ?? 0) < maxDeliveryAttempts
  ).filter(
    // Restringir at_hub según delivery_method elegido al crear el pedido.
    // Excepción: from delivery_failed, ready_for_pickup sigue disponible (fallback de última milla agotada).
    (s) => {
      if (shipment.status !== "at_hub") return true;
      if (deliveryMethod === "ultima_milla" && s === "ready_for_pickup") return false;
      if (deliveryMethod === "retiro_sucursal" && s === "out_for_delivery") return false;
      return true;
    }
  ).filter(
    // No mostrar "Cargado en vehículo" si el envío ya está en la sucursal de destino.
    // Esto permite retornos a origen (current_location === origin_branch_id).
    (s) => s !== "loaded" || !isAtDestinationBranch
  );
  const fmt = fmtDateTime;
  const fmtAddr = (a: { street?: string; city: string; province: string; postal_code?: string }) =>
    [a.street, a.city, a.province, a.postal_code].filter(Boolean).join(", ");

  const operatorOutOfBranch = (user?.role === "operator" || user?.role === "supervisor") && !!user.branch_id && user.branch_id !== shipment?.receiving_branch_id;

  return (
    <div className={`${isMobile ? "p-4" : "p-6 md:px-8"} max-w-[1100px] mx-auto`}>
      <button
        onClick={() => navigate("/")}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        Volver al listado
      </button>

      <div className={`grid ${isMobile ? "grid-cols-1 gap-4" : "grid-cols-[720px_300px] gap-8"} items-start`}>

      {/* ── Left column ── */}
      <div>
      <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-200">
        <div className="flex items-center gap-3 min-w-0">
          <code className="text-xl font-mono font-bold text-slate-900 tracking-tight">{shipment.tracking_id}</code>
          <StatusBadge status={shipment.status} label={shipmentStatusLabelOverride(shipment)} />
          <PriorityBadge priority={shipment.priority} />
        </div>
        <div className="flex items-center gap-2">
          {hasRole("supervisor", "admin", "operator") && !["draft", "pending_payment", "delivered", "returned", "cancelled", "lost", "destroyed"].includes(shipment.status) && !operatorOutOfBranch && (
            <button
              onClick={openCorrectionModal}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-sm font-semibold text-slate-700 cursor-pointer transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
              Editar datos
            </button>
          )}
          {hasRole("operator", "supervisor", "admin") && !["draft", "pending_payment", "delivered", "returned", "cancelled", "lost", "destroyed"].includes(shipment.status) && !operatorOutOfBranch && (
            <button
              onClick={() => { setShowIncidentModal(true); setIncidentError(""); setIncidentDescription(""); setIncidentType("extraviado"); }}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-200 text-sm font-semibold text-amber-800 cursor-pointer transition-colors"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Incidencia
            </button>
          )}
          {hasRole("operator", "supervisor") && ["at_origin_hub", "at_hub", "ready_for_pickup"].includes(shipment.status) && !operatorOutOfBranch && (
            <button
              onClick={() => { setCancelReason(""); setCancelError(""); setShowCancelModal(true); }}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-white hover:bg-rose-50 border border-rose-300 text-sm font-semibold text-rose-700 cursor-pointer transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Cancelar
            </button>
          )}
        </div>
      </div>
      {/* Banner: contra-envío */}
      {shipment.parent_shipment_id && (
        <div className="flex items-start gap-2.5 mb-4 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50">
          <Undo2 className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-900">
            Este es un <strong>contra-envío</strong> generado a partir de{" "}
            <a href={`/shipments/${shipment.parent_shipment_id}`} className="font-bold underline">
              {shipment.parent_shipment_id}
            </a>
          </p>
        </div>
      )}

      {/* Banner: modo devolución */}
      {shipment.is_returning && (
        <div className="flex items-center gap-2.5 mb-4 px-4 py-3 rounded-xl border border-violet-200 bg-violet-50">
          <Undo2 className="w-4 h-4 text-violet-700 shrink-0" />
          <p className="text-sm text-violet-900">Este envío está en <strong>modo devolución</strong></p>
        </div>
      )}

      {/* Banner: reservado para pickup por vehículo de otra sucursal */}
      {reservedTrip && (
        <div className="flex items-start gap-2.5 mb-4 px-4 py-3 rounded-xl border border-sky-200 bg-sky-50">
          <Truck className="w-4 h-4 text-sky-700 shrink-0 mt-0.5" />
          <div className="text-sm text-sky-900">
            <p className="font-semibold">Reservado para pickup por vehículo en tránsito</p>
            <p className="text-sky-700 mt-0.5">
              Vehículo <strong>{reservedTrip.license_plate}</strong> proveniente de{" "}
              <strong>{branchLabelById(reservedTrip.origin_branch_id, branches)}</strong> pasará a levantarlo.
              No requiere acción de esta sucursal.
            </p>
          </div>
        </div>
      )}

      {/* Contador de intentos de entrega */}
      {!shipment.is_returning && (shipment.delivery_attempts ?? 0) > 0 && (() => {
        const attempts = shipment.delivery_attempts ?? 0;
        const atLimit = attempts >= maxDeliveryAttempts;
        return (
          <div className={`flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 mb-3.5 text-[13px] ${
            atLimit
              ? "bg-[var(--danger-bg)] border border-[var(--danger-border)] text-[var(--danger-text)]"
              : "bg-[var(--warn-bg)] border border-[var(--warn-border)] text-[var(--warn-text)]"
          }`}>
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              Intentos de entrega fallidos:{" "}
              <strong>{attempts}/{maxDeliveryAttempts}</strong>
              {atLimit && " — límite alcanzado, no se puede reintentar"}
            </span>
          </div>
        );
      })()}

      {shipment.status === "draft" && branchCapacity != null && branchCapacity.current >= branchCapacity.max_capacity && (
        <div className="bg-[var(--warn-bg)] border border-[var(--warn-border)] rounded-lg p-3 mb-3.5 text-[13px] text-[var(--warn-text)]">
          <strong><AlertTriangle className="w-4 h-4 inline shrink-0 align-text-bottom" /> La sucursal receptora está al límite de capacidad</strong>
          <div className="mt-1 text-[var(--warn-text)]">
            {branchCapacity.current} de {branchCapacity.max_capacity} bultos ({branchCapacity.percentage}% de ocupación). Podés confirmar el envío, pero la sucursal estará por encima de su capacidad.
          </div>
        </div>
      )}

      {shipment.status === "pending_payment" && (
        <PendingPaymentPanel
          trackingId={shipment.tracking_id}
          onBackToDraft={() => navigate("/?status=pending")}
        />
      )}

      {shipment.status === "draft" && draftForm ? (
        /* ── Draft edit form ── */
        <DraftEditForm
          form={draftForm}
          onChange={setDraftForm}
          onConfirm={handleConfirmDraft}
          onDiscard={handleDiscardDraft}
          confirming={confirming}
          confirmError={confirmError}

          createdAt={fmt(shipment.created_at)}
          draftId={shipment.tracking_id}
          branches={branches}
        />
      ) : (
        /* ── Read-only info grid ── */
        <>
          <div className={`grid ${isMobile ? "grid-cols-1" : "grid-cols-2"} gap-3 mb-4`}>
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
              const pkgVal = cv("package_type", PACKAGE_LABELS[shipment.package_type]);
              const instrVal = cv("special_instructions", shipment.special_instructions ?? "");
              return <>
                <Card title="Remitente">
                  <InfoRowEx {...cv("sender_name", shipment.sender.name)} label="Nombre" />
                  <InfoRowEx {...cv("sender_phone", shipment.sender.phone)} label="Teléfono" />
                  {(shipment.sender.email || cor.sender_email) && <InfoRowEx {...cv("sender_email", shipment.sender.email ?? "")} label="Email" />}
                  {(shipment.sender.dni || cor.sender_dni) && <InfoRowEx {...cv("sender_dni", shipment.sender.dni ?? "")} label="DNI" />}
                  <InfoRowEx value={originParts || originalOrigin} original={originalOrigin} corrected={originCorrected} label="Origen" />
                </Card>
                <Card title="Destinatario">
                  <InfoRowEx {...cv("recipient_name", shipment.recipient.name)} label="Nombre" />
                  <InfoRowEx {...cv("recipient_phone", shipment.recipient.phone)} label="Teléfono" />
                  {(shipment.recipient.email || cor.recipient_email) && <InfoRowEx {...cv("recipient_email", shipment.recipient.email ?? "")} label="Email" />}
                  {(shipment.recipient.dni || cor.recipient_dni) && <InfoRowEx {...cv("recipient_dni", shipment.recipient.dni ?? "")} label="DNI" />}
                  <InfoRowEx value={destParts || originalDest} original={originalDest} corrected={destCorrected} label="Destino" />
                </Card>
                <Card title="Paquete">
                  <InfoRowEx {...pkgVal} label="Tipo" />
                  {shipment.is_fragile && <InfoRow label="Frágil" value="Sí" />}
                  {shipment.shipment_type && <InfoRow label="Tipo de envío" value={shipment.shipment_type === "express" ? "Express" : "Normal"} />}
                  {(cor.time_window ?? shipment.time_window) && (() => {
                    const tw = cor.time_window ?? shipment.time_window;
                    const twLabel = tw === "morning" ? "Mañana" : tw === "afternoon" ? "Tarde" : "Flexible";
                    return cor.time_window
                      ? <InfoRowEx value={twLabel} original={shipment.time_window === "morning" ? "Mañana" : shipment.time_window === "afternoon" ? "Tarde" : "Flexible"} corrected label="Ventana horaria" />
                      : <InfoRow label="Ventana horaria" value={twLabel} />;
                  })()}
                  {(() => {
                    const changedByChat = events.some(ev => ev.notes === "Destinatario solicitó retiro en sucursal vía chatbot");
                    const dmLabel = (shipment.delivery_method ?? "ultima_milla") === "retiro_sucursal" ? "Retiro en sucursal" : "Última milla (a domicilio)";
                    return changedByChat
                      ? <InfoRowEx label="Método de entrega" value="Retiro en sucursal" original="Última milla (a domicilio)" corrected />
                      : <InfoRow label="Método de entrega" value={dmLabel} />;
                  })()}
                  {shipment.priority && <InfoRow label="Prioridad" value={<PriorityBadge priority={shipment.priority} />} />}
                  <InfoRow label="Peso" value={(!shipment.weight_kg || shipment.weight_kg <= 0) && shipment.status === "draft" ? "Sin definir" : `${shipment.weight_kg} kg`} />
                  {(shipment.special_instructions || cor.special_instructions) && <InfoRowEx {...instrVal} label="Instrucciones" />}
                </Card>
                <Card title="Fechas y ubicación">
                  <InfoRow label="Creado"          value={fmt(shipment.created_at)} />
                  {(() => {
                    const rescheduled = (shipment.chatbot_metadata?.reschedule_count ?? 0) > 0;
                    const originalDate = shipment.chatbot_metadata?.original_delivery_date;
                    if (rescheduled && originalDate && shipment.estimated_delivery_at) {
                      return <InfoRowEx label="Entrega est." value={fmt(shipment.estimated_delivery_at)} original={fmt(originalDate)} corrected />;
                    }
                    return <InfoRow label="Entrega est." value={shipment.estimated_delivery_at ? fmt(shipment.estimated_delivery_at) : "—"} />;
                  })()}
                  {shipment.delivered_at && <InfoRow label="Entregado" value={fmt(shipment.delivered_at)} />}
                  {shipment.current_location && (
                    <InfoRow label="Ubicación actual" value={<><MapPin className="w-4 h-4 inline" /> {branchLabelById(shipment.current_location, branches)}</>} />
                  )}
                  {shipment.current_zone && (
                    <InfoRow label="Zona" value={<ZoneBadge zone={shipment.current_zone} />} />
                  )}
                </Card>
              </>;
            })()}
          </div>
          <RouteTimeline events={events} origin={shipment.sender.address.city} receivingBranchId={shipment.origin_branch_id ?? shipment.receiving_branch_id} finalBranchId={shipment.final_branch_id} destination={shipment.recipient.address.city} branches={branches} />
        </>
      )}

 {/*  BOTÓN GENERAR QR */}
{shipment.status !== "draft" && (
  <Button
    variant="outline"
    onClick={handleGenerateQR}
    disabled={!shipment.tracking_id || generatingQR}
    title={!shipment.tracking_id ? "Solo disponible para envíos confirmados" : "Generar código QR"}
    className="mr-2"
  >
    {generatingQR ? <><Loader2 className="w-4 h-4 animate-spin" /> Generando...</> : <><QrCode className="w-4 h-4" /> Generar QR</>}
  </Button>
)}

{/* BOTÓN IMPRIMIR ALTA — CA-1, CA-2, CA-3, CA-4 */}
{hasRole("operator", "supervisor", "admin") && shipment.status !== "draft" && (
  <Button
    variant="outline"
    onClick={handlePrintDocument}
    disabled={printingDoc}
    title="Imprimir comprobante de alta del envío"
  >
    {printingDoc ? <><Loader2 className="w-4 h-4 animate-spin" /> Generando...</> : <><Printer className="w-4 h-4" /> Imprimir alta</>}
  </Button>
)}

      {/* Zona actions — mover entre zonas internas de sucursal */}
      {shipment.current_zone && hasRole("operator", "supervisor") && !operatorOutOfBranch && (
        <div className="bg-[var(--ok-bg)] border border-[var(--ok-border)] rounded-xl p-4 mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[13px] font-semibold text-[var(--ok-text)]">
              Zona actual: <ZoneBadge zone={shipment.current_zone} />
            </span>
            {shipment.current_zone === "entrada" && (
              <>
                <button onClick={async () => { setMoving(true); try { await shipmentApi.moveZone(shipment.tracking_id, "salida"); reload(); } catch { setMoving(false); } finally { setMoving(false); } }} disabled={moving} className="px-3.5 py-1.5 rounded-md cursor-pointer text-[13px] font-semibold border-2 border-[var(--ok)] bg-[var(--bg-card)] text-[var(--ok-text)] disabled:opacity-50">
                  Mover a Salida
                </button>
                <button onClick={async () => { const m = prompt("Motivo (opcional):"); setMoving(true); try { await shipmentApi.moveZone(shipment.tracking_id, "revision", m ?? undefined); reload(); } catch { setMoving(false); } finally { setMoving(false); } }} disabled={moving} className="px-3.5 py-1.5 rounded-md cursor-pointer text-[13px] font-semibold border-2 border-[var(--warn)] bg-[var(--bg-card)] text-[var(--warn-text)] disabled:opacity-50">
                  Mover a Revisión
                </button>
              </>
            )}
            {shipment.current_zone === "salida" && (
              <>
                <button onClick={async () => { setMoving(true); try { await shipmentApi.moveZone(shipment.tracking_id, "revision"); reload(); } catch { setMoving(false); } finally { setMoving(false); } }} disabled={moving} className="px-3.5 py-1.5 rounded-md cursor-pointer text-[13px] font-semibold border-2 border-[var(--warn)] bg-[var(--bg-card)] text-[var(--warn-text)] disabled:opacity-50">
                  Mover a Revisión
                </button>
                <button onClick={async () => { setMoving(true); try { await shipmentApi.moveZone(shipment.tracking_id, "entrada"); reload(); } catch { setMoving(false); } finally { setMoving(false); } }} disabled={moving} className="px-3.5 py-1.5 rounded-md cursor-pointer text-[13px] font-semibold border-2 border-blue-600 bg-[var(--bg-card)] text-blue-600 disabled:opacity-50">
                  Reingresar a Entrada
                </button>
              </>
            )}
            {shipment.current_zone === "revision" && hasRole("supervisor") && (
              <>
                <button onClick={async () => { setMoving(true); try { await shipmentApi.approveFromRevision(shipment.tracking_id); reload(); } catch { setMoving(false); } finally { setMoving(false); } }} disabled={moving} className="px-3.5 py-1.5 rounded-md cursor-pointer text-[13px] font-semibold border-2 border-[var(--ok)] bg-[var(--bg-card)] text-[var(--ok-text)] disabled:opacity-50">
                  Aprobar (→ Salida)
                </button>
                <button onClick={async () => { const c = prompt("Clasificación: lost (extraviado) o destroyed (daño total)"); if (!c || !["lost", "destroyed"].includes(c)) return; const m = prompt("Motivo (opcional):") ?? ""; setMoving(true); try { await shipmentApi.classifyShipment(shipment.tracking_id, c as "lost" | "destroyed", m); reload(); } catch { setMoving(false); } finally { setMoving(false); } }} disabled={moving} className="px-3.5 py-1.5 rounded-md cursor-pointer text-[13px] font-semibold border-2 border-red-600 bg-[var(--bg-card)] text-[var(--danger-text)] disabled:opacity-50">
                  Clasificar (Perdido/Destruido)
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Status update — supervisor y operador (no admin) */}
      {(shipment.status === "loaded" || shipment.status === "in_transit") && hasRole("supervisor", "operator") && !operatorOutOfBranch && (
        <div className="bg-[var(--brand-tint)] border border-[var(--brand-tint-border)] rounded-xl p-4 mb-4">
          <p className="m-0 text-[13px] text-[var(--brand-strong)]">
            {shipment.status === "loaded"
              ? "Este envío está cargado en un vehículo esperando que se inicie el viaje. El estado se controla desde la página de Flota."
              : "Este envío está en tránsito. El estado se actualizará automáticamente cuando el vehículo complete el viaje."}
          </p>
        </div>
      )}

      {nextStatuses.length > 0 && hasRole("supervisor", "operator") && !operatorOutOfBranch && (
        <div className="bg-[var(--bg-subtle)] rounded-xl p-4 mb-4">
          <h2 className="text-base m-0 mb-3.5">Actualizar estado</h2>
          <form onSubmit={handleUpdateStatus} className="grid gap-2.5">
            <div className="flex gap-2 flex-wrap">
              {nextStatuses.map((s) => (
                <button key={s} type="button" onClick={() => {
                  if (s === "loaded") {
                    openVehiclePicker(shipment);
                  } else {
                    setNewStatus(s);
                    if (s === "out_for_delivery") {
                      usersApi.listDrivers(shipment.current_location ?? shipment.receiving_branch_id, "last_mile").then(setDrivers);
                    }
                  }
                }}
                  className={`px-3.5 py-1.5 rounded-md cursor-pointer text-[13px] font-semibold transition-colors ${
                    newStatus === s
                      ? "border-2 border-[var(--text-heading)] bg-[var(--brand-tint)] text-[var(--text-heading)]"
                      : "border-2 border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-strong)]"
                  }`}>
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
            {newStatus === "out_for_delivery" && (
              <select
                value={selectedDriverId}
                onChange={(e) => setSelectedDriverId(e.target.value)}
                required
                className="px-3 py-2 rounded-md border border-[var(--border-strong)] text-sm"
              >
                <option value="">Seleccioná un chofer (obligatorio)</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>{d.username}</option>
                ))}
              </select>
            )}
            {newStatus === "delivered" && (
              <input
                value={recipientDni}
                onChange={(e) => setRecipientDni(e.target.value)}
                placeholder="DNI del destinatario (obligatorio)"
                required
                className="px-3 py-2 rounded-md border border-[var(--border-strong)] text-sm"
              />
            )}
            {newStatus === "returned" && !shipment.parent_shipment_id && (
              <input
                value={senderDni}
                onChange={(e) => setSenderDni(e.target.value)}
                placeholder="DNI del remitente (obligatorio)"
                required
                className="px-3 py-2 rounded-md border border-[var(--border-strong)] text-sm"
              />
            )}
            {newStatus === "returned" && !!shipment.parent_shipment_id && (
              <input
                value={recipientDni}
                onChange={(e) => setRecipientDni(e.target.value)}
                placeholder="DNI del destinatario -remitente original- (obligatorio)"
                required
                className="px-3 py-2 rounded-md border border-[var(--border-strong)] text-sm"
              />
            )}
            {newStatus === "at_hub" && shipment.status === "delivery_failed" && (() => {
              const returnLocation = [...events].reverse().find(ev => ev.to_status === "at_hub")?.location;
              return returnLocation ? (
                <p className="m-0 text-[13px] text-[var(--text-secondary)]">
                  Devolviendo a: <strong>{branchLabel(returnLocation, branches)}</strong>
                </p>
              ) : null;
            })()}
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder={newStatus === "delivery_failed" ? "Motivo obligatorio (ej: destinatario ausente)" : "Notas (opcional)"}
              required={newStatus === "delivery_failed"}
              className="px-3 py-2 rounded-md border border-[var(--border-strong)] text-sm" />
            {newStatus === "delivery_failed" && !notes.trim() && (
              <p className="m-0 text-xs text-[var(--danger-text)]">El motivo es obligatorio para registrar un intento fallido.</p>
            )}
            {newStatus === "delivered" && !recipientDni.trim() && (
              <p className="m-0 text-xs text-[var(--danger-text)]">El DNI del destinatario es obligatorio para marcar como entregado.</p>
            )}
            {newStatus === "returned" && !shipment.parent_shipment_id && !senderDni.trim() && (
              <p className="m-0 text-xs text-[var(--danger-text)]">El DNI del remitente es obligatorio para registrar la devolución.</p>
            )}
            {newStatus === "returned" && !!shipment.parent_shipment_id && !recipientDni.trim() && (
              <p className="m-0 text-xs text-[var(--danger-text)]">El DNI del destinatario es obligatorio para registrar la devolución.</p>
            )}
            {updateError && <p className="text-[var(--danger-c)] m-0 text-[13px]">{updateError}</p>}
            {(() => {
              const returnedDniMissing = newStatus === "returned" && (shipment.parent_shipment_id ? !recipientDni.trim() : !senderDni.trim());
              const disabled = !newStatus || updating || (newStatus === "delivery_failed" && !notes.trim()) || (newStatus === "out_for_delivery" && !selectedDriverId) || (newStatus === "delivered" && !recipientDni.trim()) || returnedDniMissing;
              return (
            <Button type="submit" disabled={disabled} className="self-start">
              {updating ? "Actualizando..." : "Confirmar cambio"}
            </Button>
              );
            })()}
          </form>
        </div>
      )}

      {shipment.status === "delivered" && (
        <div className="bg-[var(--ok-bg)] border border-[var(--ok-border)] rounded-xl p-4 mb-4">
          <p className="m-0 text-[var(--ok-text)] font-semibold">Este envío fue entregado.</p>
        </div>
      )}

      {/* Event history — hidden for drafts */}
      {shipment.status !== "draft" && (
      <h2 className="text-base mb-3">Historial de eventos</h2>)}
      {shipment.status !== "draft" && (events.length === 0 ? (
        <p className="text-[var(--text-secondary)] text-sm">Sin eventos registrados.</p>
      ) : (
        <div className="relative pl-6">
          <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-[var(--border)]" />
          {[...events].reverse().map((ev) => (
            <div key={ev.id} className="relative mb-3">
              <div className="absolute -left-6 top-1 w-3.5 h-3.5 rounded-full bg-blue-700 border-2 border-[var(--bg-card)] shadow-[0_0_0_2px_var(--border)]" />
              <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-2.5 text-[13px]">
                {ev.event_type === "rescheduled" && ev.current_location && ev.rescheduled_date ? (
                  <>
                    <div className="flex justify-between mb-0.5">
                      <span className="font-semibold">
                        {ev.current_location.type === "DESTINATION_BRANCH"
                          ? "En Sucursal Destino"
                          : ev.current_location.type === "ORIGIN_BRANCH"
                          ? `En Sucursal Origen (${ev.current_location.branch_code})`
                          : "En tránsito"} — {ev.current_location.status}
                      </span>
                      <span className="text-[var(--text-muted)]">{fmt(ev.timestamp)}</span>
                    </div>
                    <div className="text-[var(--text-secondary)] flex gap-4 flex-wrap">
                      <span>por <strong>{ev.changed_by?.startsWith("chatbot-recipient") ? "chatbot-Destinatario" : (ev.changed_by || "sistema")}</strong></span>
                    </div>
                    <p className="mt-1 mb-0 text-[var(--danger-text)] font-medium">
                      Entrega reprogramada para el {new Date(ev.rescheduled_date).toLocaleDateString("es-AR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between mb-0.5">
                      <span className="font-semibold">{formatShipmentEventLabel(ev)}</span>
                      <span className="text-[var(--text-muted)]">{fmt(ev.timestamp)}</span>
                    </div>
                    <div className="text-[var(--text-secondary)] flex gap-4 flex-wrap">
                      <span>por <strong>{ev.changed_by?.startsWith("chatbot-recipient") ? "chatbot-Destinatario" : (ev.changed_by || "sistema")}</strong></span>
                      {ev.location && (() => {
                        const b = branches.find(x => x.id === ev.location);
                        return (
                          <span><MapPin className="w-4 h-4 inline" /> <strong>{b?.name ?? ev.location}</strong>{b && <> · {b.address.city} · <span className="text-[var(--text-muted)]">{b.province}</span></>}</span>
                        );
                      })()}
                    </div>
                    {ev.notes && <p className="mt-1 mb-0 text-[var(--text-secondary)]">{ev.notes}</p>}
                    {ev.event_type === "claim_created" && ev.notes && (() => {
                      const m = ev.notes.match(/REC-\d+/);
                      if (m) {
                        const claimId = m[0];
                        return (
                          <p className="mt-1.5 mb-0">
                            <Link to={`/claims/${claimId}`} className="text-[var(--text-heading)] font-bold">Ver reclamo {claimId}</Link>
                          </p>
                        );
                      }
                      return null;
                    })()}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
      </div>{/* end maxWidth wrapper */}
      </div>{/* end left column */}

      {/* ── Right column: Price, Vehicle & Comments ── */}
      <div className={isMobile ? "" : "sticky top-6"}>
        {/* Price Card */}
        {shipment.price != null && shipment.status !== "draft" && (
          <PriceCard price={shipment.price} breakdown={shipment.price_breakdown} />
        )}

        {/* Vehicle Card */}
        <div className="bg-[var(--bg-subtle)] rounded-xl p-4 mb-4">
          <h2 className="text-base m-0 mb-3">Vehículo asignado</h2>
          {loadingVehicle ? (
            <p className="text-[var(--text-secondary)] text-[13px] m-0">Cargando...</p>
          ) : assignedVehicle ? (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
                  <Truck className="w-6 h-6 text-emerald-600" />
                </div>
                <div className="flex-1">
                  <p
                    onClick={() => setShowVehicleDetail(true)}
                    className="text-base font-bold text-[var(--text-heading)] m-0 cursor-pointer underline decoration-dotted"
                  >
                    {assignedVehicle.license_plate}
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    {assignedVehicle.type === "auto" ? "Auto" : assignedVehicle.type === "furgoneta" ? "Furgoneta" : "Camión"} · {assignedVehicle.capacity_kg} kg
                  </p>
                </div>
                <div className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-[11px] font-semibold text-emerald-600">
                  {assignedVehicle.status_label}
                </div>
              </div>
              <div className="border-t border-[var(--border)] pt-2.5">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-[var(--text-secondary)]">ID: </span>
                    <span className="font-semibold text-[var(--text-strong)]">#{assignedVehicle.id}</span>
                  </div>
                  {assignedVehicle.updated_by && (
                    <div>
                      <span className="text-[var(--text-secondary)]">Por: </span>
                      <span className="font-semibold text-[var(--text-strong)]">{assignedVehicle.updated_by}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <Truck className="w-8 h-8 text-[var(--text-muted)] mx-auto mb-2" />
              <p className="text-[13px] text-[var(--text-secondary)] m-0">Sin vehículo asignado</p>
            </div>
          )}
        </div>

        {/* Incidents Card */}
        <div className="bg-[var(--bg-subtle)] rounded-xl p-4 mb-4">
          <h2 className="text-base m-0 mb-3">Incidencias</h2>
          {incidents.length === 0 ? (
            <p className="text-[var(--text-secondary)] text-[13px] m-0">Sin incidencias registradas.</p>
          ) : (
            <div className="grid gap-2 max-h-[400px] overflow-y-auto">
              {incidents.map((inc) => (
                <div key={inc.id} className="bg-[var(--warn-bg)] border border-[var(--warn-border)] rounded-lg p-2.5 text-[13px]">
                  <div className="flex justify-between items-start mb-1.5">
                    <span className="font-bold text-[var(--warn-text)] bg-[var(--warn-bg)] border border-[var(--warn-border)] rounded px-[7px] py-px text-[11px]">
                      {INCIDENT_TYPE_LABELS[inc.incident_type] ?? inc.incident_type}
                    </span>
                    <span className="text-[var(--text-muted)] text-[11px] whitespace-nowrap ml-2">{fmtDateTime(inc.created_at)}</span>
                  </div>
                  <p className="mt-1 mb-0 text-[var(--text-strong)] whitespace-pre-wrap">{inc.description}</p>
                  <p className="mt-1.5 mb-0 text-[var(--text-muted)] text-[11px]">Reportado por: {inc.reported_by}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Comments Card */}
        <div className="bg-[var(--bg-subtle)] rounded-xl p-4">
          <h2 className="text-base m-0 mb-3">Comentarios</h2>
          {hasRole("supervisor", "admin", "operator") && shipment.status !== "delivered" && shipment.status !== "returned" && !operatorOutOfBranch && (
            <div className="mb-3">
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Agregar un comentario..."
                rows={2}
                className="w-full px-3 py-2 rounded-md border border-[var(--border-strong)] text-sm resize-y font-[inherit] box-border"
              />
              <Button
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
                className="mt-1.5"
              >
                {addingComment ? "Agregando..." : "Agregar comentario"}
              </Button>
            </div>
          )}
          {comments.length === 0 ? (
            <p className="text-[var(--text-secondary)] text-[13px] m-0">Sin comentarios todavía.</p>
          ) : (
            <div className="grid gap-2 max-h-[500px] overflow-y-auto">
              {comments.map((c) => (
                <div key={c.id} className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-2.5 text-[13px]">
                  <div className="flex justify-between mb-1">
                    <span className="font-semibold">{c.author}</span>
                    <span className="text-[var(--text-muted)] text-xs">{fmtDateTime(c.created_at)}</span>
                  </div>
                  <p className="m-0 text-[var(--text-strong)] whitespace-pre-wrap">{c.body}</p>
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

      {/* Incident report modal */}
      {showIncidentModal && trackingId && (
        <div
          className="fixed inset-0 bg-black/45 z-[200] flex items-center justify-center p-4"
          onClick={() => setShowIncidentModal(false)}
        >
          <div
            className="bg-[var(--bg-card)] rounded-xl p-6 max-w-[480px] w-full shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="m-0 text-lg text-[var(--text-primary)]">Registrar incidencia</h2>
              <button onClick={() => setShowIncidentModal(false)} aria-label="Cerrar" className="bg-transparent border-none text-[22px] cursor-pointer text-[var(--text-secondary)]">✕</button>
            </div>
            {incidentError && (
              <div className="bg-[var(--danger-bg)] border border-[var(--danger-border)] text-[var(--danger-text)] px-3 py-2 rounded-md mb-3 text-[13px]">
                {incidentError}
              </div>
            )}
            <div className="mb-3.5">
              <label className="block text-[13px] font-semibold text-[var(--text-strong)] mb-1.5">Tipo de incidencia</label>
              <select
                value={incidentType}
                onChange={(e) => setIncidentType(e.target.value as IncidentType)}
                className="w-full px-2.5 py-2 border border-[var(--border-strong)] rounded-md text-[13px] bg-[var(--bg-card)]"
              >
                {(Object.entries(INCIDENT_TYPE_LABELS) as [IncidentType, string][]).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            {TERMINAL_INCIDENT_STATUS[incidentType] && (
              <div className="bg-[var(--warn-bg)] border border-[var(--warn)] text-[var(--warn-text)] px-3 py-2.5 rounded-md mb-3.5 text-[13px] leading-relaxed">
                <strong>Atención:</strong> Al confirmar esta incidencia, el envío quedará en estado <strong>{incidentType === "extraviado" ? "Extraviado" : "Daño total"}</strong> y no podrá continuar su flujo. Esta acción es irreversible.
              </div>
            )}
            <div className="mb-[18px]">
              <label className="block text-[13px] font-semibold text-[var(--text-strong)] mb-1.5">Descripción</label>
              <textarea
                value={incidentDescription}
                onChange={(e) => setIncidentDescription(e.target.value)}
                placeholder="Describí el problema detectado..."
                rows={4}
                className="w-full box-border px-2.5 py-2 border border-[var(--border-strong)] rounded-md text-[13px] font-[inherit] resize-y"
              />
            </div>
            <div className="flex gap-2.5 justify-end">
              <Button variant="outline" onClick={() => setShowIncidentModal(false)}>
                Cancelar
              </Button>
              <Button
                variant={TERMINAL_INCIDENT_STATUS[incidentType] ? "destructive" : "default"}
                disabled={reportingIncident || !incidentDescription.trim()}
                onClick={async () => {
                  if (!incidentDescription.trim()) return;
                  setReportingIncident(true);
                  setIncidentError("");
                  try {
                    await shipmentApi.reportIncident(trackingId, incidentType, incidentDescription.trim());
                    setShowIncidentModal(false);
                    const [incs, s] = await Promise.all([
                      shipmentApi.getIncidents(trackingId),
                      shipmentApi.get(trackingId),
                    ]);
                    setIncidents(incs ?? []);
                    setShipment(s);
                  } catch (err: unknown) {
                    const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Error al registrar la incidencia.";
                    setIncidentError(msg);
                  } finally {
                    setReportingIncident(false);
                  }
                }}
              >
                {reportingIncident ? "Registrando..." : TERMINAL_INCIDENT_STATUS[incidentType] ? "Confirmar y cerrar envío" : "Confirmar registro"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Vehicle picker modal for loaded */}
      {showVehiclePicker && shipment && (
        <div
          className="fixed inset-0 bg-black/45 z-[200] flex items-center justify-center p-4"
          onClick={() => setShowVehiclePicker(false)}
        >
          <div
            className="bg-[var(--bg-card)] rounded-xl p-6 max-w-[520px] w-full max-h-[80vh] overflow-y-auto shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="m-0 text-lg text-[var(--text-primary)]">Asignar vehículo — Cargar en vehículo</h2>
              <button onClick={() => setShowVehiclePicker(false)} aria-label="Cerrar" className="bg-transparent border-none text-[22px] cursor-pointer text-[var(--text-secondary)]">✕</button>
            </div>
            <p className="m-0 mb-4 text-[13px] text-[var(--text-secondary)]">
              Seleccioná un vehículo disponible en esta sucursal. Peso del envío: <strong>{effectiveWeightKg(shipment)} kg</strong>.
            </p>
            {vehiclePickerError && (
              <div className="bg-[var(--danger-bg)] border border-[var(--danger-border)] text-[var(--danger-text)] px-3 py-2 rounded-md mb-3 text-[13px]">
                {vehiclePickerError}
              </div>
            )}
            {loadingVehicles ? (
              <p className="text-[var(--text-secondary)] text-[13px]">Cargando vehículos disponibles...</p>
            ) : availableVehicles.length === 0 ? (
              <p className="text-[var(--text-secondary)] text-[13px]">No hay vehículos disponibles en esta sucursal con capacidad suficiente.</p>
            ) : (
              <div className="flex flex-col gap-2 mb-4">
                {availableVehicles.map((v) => {
                  const usedKg = (v.assigned_shipments ?? []).length > 0
                    ? v.capacity_kg - v.capacity_kg // we don't have weights here, show raw capacity
                    : 0;
                  const remainingKg = v.capacity_kg - usedKg;
                  const isSelected = selectedVehiclePlate === v.license_plate;
                  return (
                    <div
                      key={v.license_plate}
                      onClick={() => setSelectedVehiclePlate(v.license_plate)}
                      className={`flex items-center gap-3 rounded-lg px-3.5 py-3 cursor-pointer transition-colors ${
                        isSelected
                          ? "border-2 border-blue-700 bg-[var(--brand-tint)]"
                          : "border border-[var(--border)] bg-[var(--bg-card)]"
                      }`}
                    >
                      <div className="flex-1">
                        <p className="m-0 font-bold text-[15px] text-[var(--text-primary)]">{v.license_plate}</p>
                        <p className="mt-0.5 mb-0 text-xs text-[var(--text-secondary)]">
                          {v.type === "auto" ? "Auto" : v.type === "furgoneta" ? "Furgoneta" : "Camión"}
                          {" · "}Capacidad disponible: {remainingKg.toFixed(0)} kg
                          {(v.assigned_shipments ?? []).length > 0 && ` · ${v.assigned_shipments!.length} envío(s) cargado(s)`}
                        </p>
                      </div>
                      {isSelected && <span className="text-[var(--text-heading)] font-bold">✓</span>}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowVehiclePicker(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleAssignVehicle}
                disabled={!selectedVehiclePlate || assigningVehicle}
              >
                {assigningVehicle ? "Asignando..." : "Asignar vehículo"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showVehicleDetail && assignedVehicle && (
        <VehicleDetailModal
          vehicle={assignedVehicle}
          onClose={() => setShowVehicleDetail(false)}
          onRefresh={() => loadAssignedVehicle(trackingId!)}
        />
      )}

      {showCancelModal && (
        <div className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center">
          <div className="bg-[var(--bg-card)] rounded-xl px-8 py-7 max-w-[440px] w-[calc(100vw-32px)] shadow-[0_8px_32px_rgba(0,0,0,0.18)]">
            <h2 className="m-0 mb-2 text-lg text-[var(--danger-text)]">Cancelar envío</h2>
            <p className="m-0 mb-5 text-sm text-[var(--text-secondary)]">
              Esta acción es irreversible. El envío pasará a <strong>Cancelado</strong> y no podrá continuar en tránsito.
            </p>
            <label className="text-xs font-semibold text-[var(--text-strong)] block mb-1.5">
              Motivo de cancelación *
            </label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Describí el motivo de la cancelación..."
              rows={4}
              className="w-full px-2.5 py-2 rounded-md border border-[var(--border-strong)] text-sm box-border resize-y"
            />
            {cancelError && <p className="text-[var(--danger-c)] text-[13px] mt-2 mb-0">{cancelError}</p>}
            <div className="flex gap-2.5 mt-5 justify-end">
              <Button variant="outline" onClick={() => setShowCancelModal(false)} disabled={cancelling}>
                Volver
              </Button>
              <Button variant="destructive" onClick={handleCancel} disabled={cancelling || !cancelReason.trim()}>
                {cancelling ? "Cancelando..." : "Confirmar cancelación"}
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* 🆕 AGREGAR AQUÍ - MODAL DE QR */}
      {qrData && (
        <ShipmentQRModal
          isOpen={showQRModal}
          onClose={() => setShowQRModal(false)}
          trackingId={qrData.tracking_id}
          qrCodeBase64={qrData.qr_code_base64}
        />
      )}

      {qrError && (
        <div className="fixed bottom-6 right-6 bg-[var(--danger-bg)] border border-[var(--danger-border)] text-[var(--danger-text)] px-4 py-3 rounded-lg text-[13px] shadow-[0_4px_12px_rgba(0,0,0,0.1)] z-[1001]">
          {qrError}
        </div>
      )}
      {printDocError && (
        <div className={`fixed ${qrError ? "bottom-20" : "bottom-6"} right-6 bg-[var(--danger-bg)] border border-[var(--danger-border)] text-[var(--danger-text)] px-4 py-3 rounded-lg text-[13px] shadow-[0_4px_12px_rgba(0,0,0,0.1)] z-[1001]`}>
          {printDocError}
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
  { value: "envelope", label: "Sobre" },
  { value: "box",      label: "Caja" },
];
const SHIPMENT_TYPES = [
  { value: "normal",  label: "Normal" },
  { value: "express", label: "Express" },
];
const TIME_WINDOWS = [
  { value: "flexible",  label: "Flexible" },
  { value: "morning",   label: "Mañana (8-12)" },
  { value: "afternoon", label: "Tarde (12-18)" },
];
const DELIVERY_METHODS = [
  { value: "ultima_milla",    label: "Última milla (entrega a domicilio)" },
  { value: "retiro_sucursal", label: "Retiro en sucursal" },
];

function CustomerSuggestion({ customer, onApply, onDismiss }: { customer: Customer; onApply: () => void; onDismiss: () => void }) {
  return (
    <div className="absolute top-[calc(100%+4px)] left-0 right-0 z-50 border border-[var(--brand-tint-border)] bg-[var(--brand-tint)] rounded-lg p-2.5 flex justify-between items-center gap-3 shadow-[0_4px_12px_rgba(0,0,0,0.1)]">
      <div className="text-[13px] text-blue-600 leading-relaxed min-w-0">
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
          className="bg-blue-600 text-white border-none rounded-md px-3 py-1.5 cursor-pointer text-xs font-semibold">
          Usar datos
        </button>
        <button type="button" onClick={onDismiss}
          className="bg-transparent text-[var(--text-secondary)] border border-[var(--border-strong)] rounded-md px-2.5 py-1.5 cursor-pointer text-xs">
          ✕
        </button>
      </div>
    </div>
  );
}

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

function DraftEditForm({ form, onChange, onConfirm, onDiscard, confirming, confirmError, createdAt, draftId, branches }: {
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

  // Auto-save: debounced 1 s after every form change
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
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
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

  // Live pricing quote
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
            {senderNameError && <span className="text-red-600 text-xs">{senderNameError}</span>}
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
            {recipientNameError && <span className="text-red-600 text-xs">{recipientNameError}</span>}
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
        {/* CA-05: Privacy notice — shown once the operator has entered recipient data */}
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
          {/* Sucursal de origen */}
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
          {/* Sucursal final */}
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
          {/* Auto-save status */}
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

const fsClass = "border border-[var(--border)] rounded-xl p-3.5";
const legClass = "font-bold text-[13px] text-[var(--text-heading)] px-1.5";
const inpClass = "px-2.5 py-1.5 rounded-md border border-[var(--border-strong)] text-[13px] w-full box-border";

function RouteTimeline({ events, origin, receivingBranchId, finalBranchId, destination, branches }: {
  events: ShipmentEvent[];
  origin: string;
  receivingBranchId?: string;
  finalBranchId?: string;
  destination: string;
  branches: Branch[];
}) {
  if (events.length === 0) return null;

  const receivingBranch = receivingBranchId ? branches.find((b) => b.id === receivingBranchId) : undefined;
  const firstStop = receivingBranch ? receivingBranch.id : origin;
  const finalBranch = finalBranchId ? branches.find((b) => b.id === finalBranchId) : undefined;

  // Confirmed stops: receiving branch (or origin fallback) + each at_hub/at_origin_hub arrival
  const stops: { location: string; status: ShipmentStatus; timestamp: string; current: boolean }[] = [];

  stops.push({ location: firstStop, status: "at_origin_hub" as ShipmentStatus, timestamp: events[0].timestamp, current: false });

  // Skip events[0] — it's already the first stop. Include both at_hub and at_origin_hub so
  // return passages through the origin branch (promoted to at_origin_hub by the backend) are shown.
  for (const ev of events.slice(1)) {
    if ((ev.to_status === "at_hub" || ev.to_status === "at_origin_hub") && ev.location) {
      stops.push({ location: ev.location, status: ev.to_status, timestamp: ev.timestamp, current: false });
    }
  }

  stops[stops.length - 1].current = true;

  const lastEvent = events[events.length - 1];
  const isInTransit = lastEvent?.to_status === "in_transit";
  const nextBranch = isInTransit ? lastEvent.location : null;
  const isDelivering = lastEvent?.to_status === "out_for_delivery";
  const isDelivered = lastEvent?.to_status === "delivered";

  const statusColors: Record<ShipmentStatus, string> = {
    draft: "bg-gray-400 border-gray-400", at_origin_hub: "bg-amber-500 border-amber-500", loaded: "bg-cyan-500 border-cyan-500", in_transit: "bg-blue-500 border-blue-500",
    at_hub: "bg-violet-500 border-violet-500", out_for_delivery: "bg-orange-500 border-orange-500", delivery_failed: "bg-red-500 border-red-500",
    redelivery_scheduled: "bg-orange-400 border-orange-400", no_entregado: "bg-gray-500 border-gray-500", rechazado: "bg-red-600 border-red-600",
    delivered: "bg-green-500 border-green-500", ready_for_pickup: "bg-cyan-600 border-cyan-600", ready_for_return: "bg-violet-600 border-violet-600",
    returned: "bg-gray-500 border-gray-500", cancelled: "bg-red-700 border-red-700", lost: "bg-gray-700 border-gray-700", destroyed: "bg-gray-800 border-gray-800", expired: "bg-gray-400 border-gray-400",
    pending_payment: "bg-amber-600 border-amber-600",
  };

  const statusRingColors: Record<ShipmentStatus, string> = {
    draft: "var(--text-muted)", at_origin_hub: "ring-amber-500/20", loaded: "ring-cyan-500/20", in_transit: "ring-blue-500/20",
    at_hub: "ring-violet-500/20", out_for_delivery: "ring-orange-500/20", delivery_failed: "ring-red-500/20",
    redelivery_scheduled: "ring-orange-400/20", no_entregado: "ring-gray-500/20", rechazado: "ring-red-600/20",
    delivered: "ring-emerald-500/20", ready_for_pickup: "ring-cyan-600/20", ready_for_return: "ring-violet-600/20",
    returned: "ring-gray-500/20", cancelled: "ring-red-700/20", lost: "ring-gray-700/20", destroyed: "ring-gray-800/20", expired: "var(--text-muted)",
    pending_payment: "ring-amber-600/20",
  };

  const solidLine = (color = "bg-[var(--border)]") => (
    <div className={`w-10 h-0.5 ${color} shrink-0 mx-1 mb-6`} />
  );
  const dashedLine = () => (
    <div className="w-10 h-0.5 shrink-0 mx-1 mb-6 bg-[repeating-linear-gradient(to_right,var(--border-strong)_0,var(--border-strong)_5px,transparent_5px,transparent_9px)]" />
  );

  return (
    <div className="bg-[var(--bg-subtle)] rounded-xl p-4 mb-4">
      <h3 className="m-0 mb-4 text-[13px] text-[var(--text-heading)] uppercase tracking-wide">
        Route · {origin} → {destination}
      </h3>
      <div className="flex items-center gap-0 overflow-x-auto pb-1">
        {stops.map((stop, i) => (
          <div key={i} className="flex items-center shrink-0">
            <div className="flex flex-col items-center gap-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                stop.current
                  ? `${statusColors[stop.status]} border-[3px] ${statusColors[stop.status]} ${statusRingColors[stop.status]} ring-[3px]`
                  : "bg-[var(--border)] border-[3px] border-[var(--border)]"
              }`}>
                <Circle className="w-3.5 h-3.5 text-white" fill="currentColor" />
              </div>
              <div className="text-center max-w-[80px]">
                {(() => {
                  const b = branches.find(x => x.id === stop.location);
                  return (
                    <div className={`text-[11px] whitespace-nowrap ${stop.current ? "font-bold text-[var(--text-heading)]" : "font-medium text-[var(--text-secondary)]"}`}>{b?.name ?? stop.location}</div>
                  );
                })()}
                <div className="text-[10px] text-[var(--text-muted)]">{fmtDate(stop.timestamp)}</div>
                {stop.location === finalBranchId && (
                  <div className="text-[10px] text-violet-600 font-semibold mt-0.5">Sucursal final</div>
                )}
              </div>
            </div>
            {i < stops.length - 1 && solidLine()}
          </div>
        ))}

        {/* Delivering: dashed line to Recipient node */}
        {isDelivering && (
          <>
            {dashedLine()}
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className="w-8 h-8 rounded-full bg-[var(--bg-subtle)] border-[3px] border-dashed border-amber-500 flex items-center justify-center">
                <Truck className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-[11px] text-amber-500 font-semibold whitespace-nowrap">Destinatario</div>
            </div>
          </>
        )}

        {/* In transit: dashed line to uncolored next branch */}
        {isInTransit && nextBranch && (
          <>
            {dashedLine()}
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className="w-8 h-8 rounded-full bg-[var(--bg-subtle)] border-[3px] border-dashed border-[var(--border-strong)] flex items-center justify-center">
                <Circle className="w-4 h-4 text-[var(--border-strong)]" />
              </div>
              <div className="text-center max-w-[80px]">
                {(() => {
                  const b = branches.find(x => x.id === nextBranch);
                  return (
                    <div className="text-[11px] text-[var(--text-muted)] whitespace-nowrap">{b?.name ?? nextBranch}</div>
                  );
                })()}
              </div>
            </div>
          </>
        )}

        {/* Final branch — shown as pending node if not yet visited */}
        {finalBranch && !stops.some(s => s.location === finalBranchId) && !isDelivered && !isDelivering && (
          <>
            {dashedLine()}
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className="w-8 h-8 rounded-full bg-[var(--bg-subtle)] border-[3px] border-dashed border-violet-500 flex items-center justify-center">
                <Circle className="w-4 h-4 text-violet-500" />
              </div>
              <div className="text-center max-w-[80px]">
                <div className="text-[11px] text-violet-500 font-semibold whitespace-nowrap">{finalBranch.name}</div>
                <div className="text-[10px] text-[var(--text-muted)]">Sucursal final</div>
              </div>
            </div>
          </>
        )}

        {/* Final destination — always shown */}
        <>
          {isDelivered ? solidLine("bg-emerald-500") : dashedLine()}
          <div className="flex flex-col items-center gap-1 shrink-0">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
              isDelivered
                ? "bg-emerald-500 border-[3px] border-emerald-500 ring-[3px] ring-emerald-500/20"
                : "bg-[var(--bg-subtle)] border-[3px] border-dashed border-[var(--border-strong)]"
            }`}>
              {isDelivered ? (
                <Check className="w-4 h-4 text-white" />
              ) : (
                <Flag className="w-4 h-4 text-[var(--border-strong)]" />
              )}
            </div>
            <div className={`text-[11px] whitespace-nowrap ${isDelivered ? "font-bold text-emerald-600" : "font-normal text-[var(--text-muted)]"}`}>Destinatario</div>
          </div>
        </>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--bg-subtle)] rounded-xl p-4 border-l-[3px] border-blue-500">
      <h3 className="m-0 mb-3 text-[13px] text-[var(--text-heading)] uppercase tracking-wide">{title}</h3>
      <div className="grid gap-1.5">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-[13px]">
      <span className="text-[var(--text-muted)] min-w-[90px] shrink-0">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function PriceCard({ price, breakdown }: { price: number; breakdown?: import("../api/shipments").PriceBreakdown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-gradient-to-br from-blue-900 to-blue-800 rounded-xl p-[18px] mb-4 text-white shadow-[0_4px_12px_rgba(30,58,95,0.15)]">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
          <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="m-0 text-[11px] text-white/70 font-semibold uppercase tracking-wide">
            Precio del envío
          </p>
          <p className="mt-0.5 mb-0 text-2xl font-extrabold tabular-nums">
            {formatCurrencyARS(price)}
          </p>
        </div>
      </div>

      {breakdown && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="w-full bg-white/10 hover:bg-white/[0.18] border border-white/15 text-white rounded-lg px-3 py-2 cursor-pointer text-xs font-semibold flex items-center justify-between transition-colors"
          >
            <span>{open ? "Ocultar desglose" : "Ver desglose"}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>

          {open && (
            <div className="mt-3 pt-3 border-t border-white/15 grid gap-2 text-xs">
              <PriceRow label="Tarifa base" value={formatCurrencyARS(breakdown.base_fare)} />
              <PriceRow
                label={`Distancia (${breakdown.distance_km.toFixed(1)} km)`}
                value={formatCurrencyARS(breakdown.distance_cost)}
              />
              {breakdown.weight_surcharge > 0 && (
                <PriceRow label="Recargo por peso" value={formatCurrencyARS(breakdown.weight_surcharge)} />
              )}
              {breakdown.last_mile_surcharge > 0 && (
                <PriceRow label="Entrega a domicilio" value={formatCurrencyARS(breakdown.last_mile_surcharge)} />
              )}
              {breakdown.risky_zone_surcharge > 0 && (
                <PriceRow label={<><AlertTriangle className="w-3.5 h-3.5" /> Recargo zona peligrosa</>} value={formatCurrencyARS(breakdown.risky_zone_surcharge)} />
              )}
              {breakdown.shipment_multiplier !== 1 && (
                <PriceRow label="Tipo de envío (express)" value={formatCurrencyARS((breakdown.base_fare + breakdown.distance_cost) * (breakdown.shipment_multiplier - 1))} />
              )}
              {breakdown.time_window_surplus > 0 && (
                <PriceRow label="Recargo ventana horaria" value={formatCurrencyARS(breakdown.time_window_surplus)} />
              )}
              {breakdown.fragile_surplus > 0 && (
                <PriceRow label="Recargo frágil" value={formatCurrencyARS(breakdown.fragile_surplus)} />
              )}
              <div className="flex justify-between pt-2.5 mt-1 border-t border-white/15 font-bold text-[13px]">
                <span>Total</span>
                <span className="tabular-nums">{formatCurrencyARS(breakdown.total)}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PriceRow({ label, value }: { label: React.ReactNode; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-white/75 flex items-center gap-1">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

// InfoRowEx: same as InfoRow but supports showing original value when corrected
function InfoRowEx({ label, value, corrected, original }: { label: string; value: string; corrected: boolean; original: string }) {
  return (
    <div className="flex gap-2 text-[13px] items-start">
      <span className="text-[var(--text-muted)] min-w-[90px] shrink-0">{label}</span>
      <div className="flex flex-col gap-0.5">
        <div className="flex gap-1.5 items-center">
          <span className="font-medium">{value}</span>
          {corrected && (
            <span className="text-[10px] font-bold bg-[var(--warn-bg)] text-[var(--warn-text)] border border-[var(--warn-border)] rounded px-[5px] py-px whitespace-nowrap">
              Modificado
            </span>
          )}
        </div>
        {corrected && original && (
          <span className="text-[11px] text-[var(--text-muted)] line-through">{original}</span>
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
  const isMobile = useIsMobile();
  const set = (key: string, value: string) => onChange({ ...form, [key]: value });
  return (
    <div className="fixed inset-0 bg-black/45 z-[1000] flex items-center justify-center p-4">
      <div className="bg-[var(--bg-card)] rounded-xl p-6 max-w-[680px] w-full max-h-[90vh] overflow-y-auto shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
        <div className="flex justify-between items-center mb-4">
          <h2 className="m-0 text-lg text-[var(--text-heading)]">Corregir datos del envío</h2>
          <button onClick={onClose} aria-label="Cerrar" className="bg-transparent border-none text-xl cursor-pointer text-[var(--text-secondary)]">✕</button>
        </div>
        <p className="m-0 mb-4 text-[13px] text-[var(--text-secondary)]">
          Los datos originales no se modifican. Los cambios quedan registrados en el historial de comentarios.
        </p>

        {/* Remitente */}
        <fieldset className={fsClass}>
          <legend className={legClass}>Remitente</legend>
          <div className={`grid ${isMobile ? "grid-cols-1" : "grid-cols-2"} gap-2.5`}>
            <DField label="Nombre"><input className={inpClass} value={form.sender_name ?? ""} onChange={(e) => set("sender_name", e.target.value)} /></DField>
            <DField label="Teléfono"><input className={inpClass} value={form.sender_phone ?? ""} onChange={(e) => set("sender_phone", e.target.value.replace(/\D/g, ""))} /></DField>
            <DField label="Email"><input className={inpClass} value={form.sender_email ?? ""} onChange={(e) => set("sender_email", e.target.value)} /></DField>
            <DField label="DNI"><input className={inpClass} value={form.sender_dni ?? ""} onChange={(e) => set("sender_dni", e.target.value)} /></DField>
            <DField label="Calle (origen)">
              <input className={inpClass} value={form.origin_street ?? ""} onChange={(e) => set("origin_street", e.target.value)} placeholder="Av. Corrientes 1234" />
            </DField>
            <DField label="Ciudad (origen)"><div className={`${inpClass} bg-[var(--bg-muted)] text-[var(--text-secondary)]`}>{form.origin_city}</div></DField>
            <DField label="Provincia (origen)"><div className={`${inpClass} bg-[var(--bg-muted)] text-[var(--text-secondary)]`}>{form.origin_province}</div></DField>
            <DField label="Código postal (origen)"><div className={`${inpClass} bg-[var(--bg-muted)] text-[var(--text-secondary)]`}>{form.origin_postal_code}</div></DField>
          </div>
        </fieldset>

        {/* Destinatario */}
        <fieldset className={`${fsClass} mt-3`}>
          <legend className={legClass}>Destinatario</legend>
          <div className={`grid ${isMobile ? "grid-cols-1" : "grid-cols-2"} gap-2.5`}>
            <DField label="Nombre"><input className={inpClass} value={form.recipient_name ?? ""} onChange={(e) => set("recipient_name", e.target.value)} /></DField>
            <DField label="Teléfono"><input className={inpClass} value={form.recipient_phone ?? ""} onChange={(e) => set("recipient_phone", e.target.value.replace(/\D/g, ""))} /></DField>
            <DField label="Email"><input className={inpClass} value={form.recipient_email ?? ""} onChange={(e) => set("recipient_email", e.target.value)} /></DField>
            <DField label="DNI"><input className={inpClass} value={form.recipient_dni ?? ""} onChange={(e) => set("recipient_dni", e.target.value)} /></DField>
            <DField label="Calle (destino)">
              <input className={inpClass} value={form.destination_street ?? ""} onChange={(e) => set("destination_street", e.target.value)} placeholder="San Martín 456" />
            </DField>
            <DField label="Ciudad (destino)"><div className={`${inpClass} bg-[var(--bg-muted)] text-[var(--text-secondary)]`}>{form.destination_city}</div></DField>
            <DField label="Provincia (destino)"><div className={`${inpClass} bg-[var(--bg-muted)] text-[var(--text-secondary)]`}>{form.destination_province}</div></DField>
            <DField label="Código postal (destino)"><div className={`${inpClass} bg-[var(--bg-muted)] text-[var(--text-secondary)]`}>{form.destination_postal_code}</div></DField>
          </div>
        </fieldset>

        {/* Paquete */}
        <fieldset className={`${fsClass} mt-3`}>
          <legend className={legClass}>Paquete</legend>
          <div className={`grid ${isMobile ? "grid-cols-1" : "grid-cols-2"} gap-2.5`}>
            <DField label="Ventana horaria">
              <select className={inpClass} value={form.time_window ?? "flexible"} onChange={(e) => set("time_window", e.target.value)}>
                {TIME_WINDOWS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </DField>
            <DField label="Instrucciones especiales" className="col-span-full">
              <input className={inpClass} value={form.special_instructions ?? ""} onChange={(e) => set("special_instructions", e.target.value)} />
            </DField>
          </div>
          <p className="text-[11px] text-[var(--text-secondary)] mt-2 mb-0">
            Peso, tipo de paquete, tipo de envío y marca de frágil quedan fijos al crear el envío. La ventana horaria solo puede cambiarse a una opción de igual o menor recargo (no se permite pasar de Flexible a Mañana/Tarde).
          </p>
        </fieldset>

        {error && <p className="text-[var(--danger-c)] text-[13px] mt-3 mb-0">{error}</p>}
        <div className="flex gap-2.5 mt-4">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Guardando..." : "Guardar correcciones"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PendingPaymentPanel({
  trackingId,
  onBackToDraft,
}: {
  trackingId: string;
  onBackToDraft: () => void;
}) {
  const [payment, setPayment] = useState<Payment | null>(null);
  const [reverting, setReverting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    paymentApi.get(trackingId).then(setPayment).catch(() => {});
  }, [trackingId]);

  const handleBackToDraft = async () => {
    setReverting(true);
    setError("");
    try {
      await paymentApi.backToDraft(trackingId);
      onBackToDraft();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? "No se pudo volver al borrador.");
      setReverting(false);
    }
  };

  return (
    <div className="bg-[var(--warn-bg)] border border-[var(--warn-border)] rounded-xl p-5 mb-4">
      <div className="flex items-baseline justify-between mb-3.5 gap-3 flex-wrap">
        <div className="font-bold text-[15px] text-[var(--warn-text)]">
          <CreditCard className="w-4 h-4" /> Pago pendiente
        </div>
        {payment && (
          <div className="text-[13px] text-[var(--warn-text)]">
            Monto:{" "}
            <strong>
              {new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(payment.amount)}
            </strong>
          </div>
        )}
      </div>
      {payment ? (
        <PaymentMethodsPanel
          payment={payment}
          trackingId={trackingId}
          onCashConfirmed={(newTrackingId) => {
            window.location.href = `/shipments/${newTrackingId}`;
          }}
          onError={setError}
        />
      ) : (
        <p className="text-[13px] text-[var(--warn-text)]">Cargando información de pago…</p>
      )}
      {error && <p className="text-[var(--danger-text)] text-xs mt-2.5 mb-0">{error}</p>}
      <div className="mt-3.5 pt-3.5 border-t border-[var(--warn-border)] flex justify-end">
        <Button
          variant="outline"
          onClick={handleBackToDraft}
          disabled={reverting}
        >
          {reverting ? "Procesando…" : "← Volver a borrador"}
        </Button>
      </div>
    </div>
  );
}
