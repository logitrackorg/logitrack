import { useCallback, useEffect, useRef, useState } from "react";
import { paymentApi, type Payment } from "../api/payments";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Pencil, AlertTriangle, X, Undo2, Loader2, Truck, CreditCard, Printer, QrCode, Package, CalendarDays, Scale, MapPin, ArrowRight } from "lucide-react";
import { useOptimisticUpdate } from "../hooks/useOptimisticUpdate";
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

import { usersApi, type UserProfile } from "../api/users";
import { vehicleApi, type VehicleStatusResponse } from "../api/vehicles";
import { VehicleDetailModal } from "./VehicleList";
import { StatusBadge } from "../components/StatusBadge";
import { PriorityBadge } from "../components/PriorityBadge";
import { ZoneBadge } from "../components/ZoneBadge";
import { shipmentStatusLabelOverride } from "../utils/shipmentStatus";
import { extractErrorMessage } from "../utils/errors";

const SLA_MONITORED_DETAIL = new Set([
  "at_origin_hub", "at_hub", "loaded", "in_transit",
  "out_for_delivery", "redelivery_scheduled", "ready_for_return",
]);
function isShipmentDelayed(s: Shipment): boolean {
  if (!SLA_MONITORED_DETAIL.has(s.status) || !s.updated_at) return false;
  return Date.now() - new Date(s.updated_at).getTime() > 36 * 60 * 60 * 1000;
}
import { useAuth } from "../context/AuthContext";
import { branchApi, branchLabelById, type Branch, type BranchCapacity } from "../api/branches";
import { DetailPageSkeleton } from "../components/ui/skeleton";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { AlertBanner } from "../components/ui/alert-banner";
import { EventTimeline } from "../components/ui/event-timeline";
import { fmtDateTime } from "../utils/date";
import { useIsMobile } from "../hooks/useIsMobile";
import ShipmentQRModal from '../components/ShipmentQRModal';
import PaymentMethodsPanel from '../components/PaymentMethodsPanel';
import { qrService, type QRResponse } from '../api/qrService';
import { printShipmentDocument } from '../utils/printShipmentDocument';
import { organizationApi, type OrganizationConfig } from '../api/organizationApi';
import { systemConfigApi } from '../api/systemConfig';
import { tripsApi, type InterBranchTrip } from '../api/routing';
import { TIME_WINDOWS } from '../constants';
import { InfoCards } from './ShipmentDetail/components/InfoCards';
import { RouteTimeline } from './ShipmentDetail/components/RouteTimeline';
import { PriceCard } from './ShipmentDetail/components/PriceCard';
import { VehicleCard } from './ShipmentDetail/components/VehicleCard';
import { CommentsList } from './ShipmentDetail/components/CommentsList';
import { IncidentsList } from './ShipmentDetail/components/IncidentsList';
import { StatusUpdateForm } from './ShipmentDetail/components/StatusUpdateForm';
import { DraftEditForm } from './ShipmentDetail/components/DraftEditForm';

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

  // Optimistic status update
  const pendingUpdateRef = useRef<{
    status: ShipmentStatus;
    location: string;
    notes: string;
    driver_id?: string;
    recipient_dni?: string;
    sender_dni?: string;
  } | null>(null);

  const statusOptimistic = useOptimisticUpdate<Shipment>(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (_shipment: Shipment) => {
      const p = pendingUpdateRef.current!;
      await shipmentApi.updateStatus(trackingId!, {
        status: p.status,
        location: p.location,
        notes: p.notes,
        driver_id: p.driver_id,
        recipient_dni: p.recipient_dni,
        sender_dni: p.sender_dni,
      });
      const s = await shipmentApi.get(trackingId!);
      return s;
    },
    {
      onSuccess: (result: Shipment) => {
        setShipment(result);
        setLocation(""); setNotes(""); setSelectedDriverId(""); setRecipientDni(""); setSenderDni("");
      },
      onRollback: (_err: Error, previous: Shipment) => {
        setShipment(previous);
        setUpdateError(extractErrorMessage(_err) ?? "No se pudo actualizar el estado.");
      },
    },
  );

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
      const msg = extractErrorMessage(err);
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
      const message = extractErrorMessage(err) || 'Error al generar código QR';
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
      const message = extractErrorMessage(err) || 'Error al generar el documento de impresión';
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
      const msg = extractErrorMessage(err);
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
    if (!newStatus || !trackingId || !shipment) return;

    const previousShipment = { ...shipment };
    const optimisticShipment: Shipment = { ...shipment, status: newStatus as ShipmentStatus };

    pendingUpdateRef.current = {
      status: newStatus as ShipmentStatus,
      location,
      notes,
      driver_id: newStatus === "out_for_delivery" ? selectedDriverId : undefined,
      recipient_dni: newStatus === "delivered" || (newStatus === "returned" && !!shipment.parent_shipment_id) ? recipientDni : undefined,
      sender_dni: newStatus === "returned" && !shipment.parent_shipment_id ? senderDni : undefined,
    };

    setUpdateError("");
    setNewStatus("");
    await statusOptimistic.execute(optimisticShipment, previousShipment);
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
      const msg = extractErrorMessage(err);
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
      const msg = extractErrorMessage(err);
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
    <div className="p-6 animate-fade-in">
      <DetailPageSkeleton />
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

  const operatorOutOfBranch = (user?.role === "operator" || user?.role === "supervisor") && !!user.branch_id && user.branch_id !== shipment?.receiving_branch_id;

  return (
    <div className={`${isMobile ? "p-4" : "p-6 md:px-8"} max-w-[1100px] mx-auto animate-fade-in`}>

      {/* ═══════════════════════════════════════════════════════
          A. HERO CARD — full width, prominent
          ═══════════════════════════════════════════════════════ */}
      <div className="relative overflow-hidden rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] mb-6">
        {/* Subtle top gradient bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-600" />

        <div className="p-5 sm:p-6 lg:p-7">
          {/* Breadcrumb + back */}
          <div className="flex items-center gap-3 mb-4">
            <button
              type="button"
              onClick={() => navigate("/")}
              className="shrink-0 p-1 -ml-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)] transition-colors duration-200 cursor-pointer"
              aria-label="Volver al listado"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <nav aria-label="Breadcrumb" className="text-[12px] text-[var(--text-muted)]">
              <a href="/" className="hover:text-[var(--text-primary)] transition-colors duration-200">Envíos</a>
              <span className="mx-1.5 opacity-40">/</span>
              <span className="text-[var(--text-secondary)]">{shipment.tracking_id}</span>
            </nav>
          </div>

          {/* Main row: tracking ID + badges + actions */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              {/* Tracking ID + badges */}
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <code className="text-2xl sm:text-[1.65rem] font-mono font-bold text-[var(--text-primary)] tracking-tight">
                  {shipment.tracking_id}
                </code>
                <StatusBadge status={shipment.status} label={shipmentStatusLabelOverride(shipment)} />
                <PriorityBadge priority={shipment.priority} />
                {(shipment.is_delayed ?? isShipmentDelayed(shipment)) && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase bg-[var(--danger-bg)] border border-[var(--danger-border)] text-[var(--danger-text)]">
                    Demorado
                  </span>
                )}
              </div>

              {/* Route: origin → destination */}
              <div className="flex items-center gap-2 text-[var(--text-secondary)] text-sm flex-wrap">
                <MapPin className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                <span className="font-medium text-[var(--text-strong)]">{shipment.sender.address.city}</span>
                <ArrowRight className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)]" />
                <MapPin className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                <span className="font-medium text-[var(--text-strong)]">{shipment.recipient.address.city}</span>
              </div>

              {/* Metadata row */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-3 text-[13px] text-[var(--text-muted)]">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="w-3.5 h-3.5" />
                  Creado {fmt(shipment.created_at)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Scale className="w-3.5 h-3.5" />
                  {shipment.weight_kg ?? 0} kg
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5" />
                  {shipment.shipment_type === "express" ? "Express" : "Normal"}
                </span>
                {shipment.is_fragile && (
                  <span className="inline-flex items-center gap-1.5 text-[var(--warn-text)]">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Frágil
                  </span>
                )}
              </div>
            </div>

            {/* Action buttons group */}
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              {shipment.status !== "draft" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateQR}
                  disabled={!shipment.tracking_id || generatingQR}
                  title={!shipment.tracking_id ? "Solo disponible para envíos confirmados" : "Generar código QR"}
                  className="gap-1.5"
                >
                  {generatingQR ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <QrCode className="w-3.5 h-3.5" />}
                  QR
                </Button>
              )}

              {hasRole("operator", "supervisor", "admin") && shipment.status !== "draft" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrintDocument}
                  disabled={printingDoc}
                  title="Imprimir comprobante de alta del envío"
                  className="gap-1.5"
                >
                  {printingDoc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
                  Imprimir
                </Button>
              )}

              {hasRole("supervisor", "admin", "operator") && !["draft", "pending_payment", "delivered", "returned", "cancelled", "lost", "destroyed"].includes(shipment.status) && !operatorOutOfBranch && (
                <Button variant="outline" size="sm" onClick={openCorrectionModal} className="gap-1.5">
                  <Pencil className="w-3.5 h-3.5" />
                  Editar
                </Button>
              )}

              {hasRole("operator", "supervisor", "admin") && !["draft", "pending_payment", "delivered", "returned", "cancelled", "lost", "destroyed"].includes(shipment.status) && !operatorOutOfBranch && (
                <Button variant="outline" size="sm" onClick={() => { setShowIncidentModal(true); setIncidentError(""); setIncidentDescription(""); setIncidentType("extraviado"); }} className="gap-1.5 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/15">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Incidencia
                </Button>
              )}

              {hasRole("operator", "supervisor") && ["at_origin_hub", "at_hub", "ready_for_pickup"].includes(shipment.status) && !operatorOutOfBranch && (
                <Button variant="outline" size="sm" onClick={() => { setCancelReason(""); setCancelError(""); setShowCancelModal(true); }} className="gap-1.5 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15">
                  <X className="w-3.5 h-3.5" />
                  Cancelar
                </Button>
              )}
            </div>
      </div>

      {/* Banner: reservado para pickup por vehículo de otra sucursal */}
      {reservedTrip && (
        <div className="flex items-start gap-2.5 mb-4 px-4 py-3 rounded-xl border border-sky-200 bg-sky-50 dark:border-sky-800 dark:bg-sky-900/20">
          <Truck className="w-4 h-4 text-sky-700 dark:text-sky-400 shrink-0 mt-0.5" />
          <div className="text-sm text-sky-900 dark:text-sky-100 flex-1">
            <p className="font-semibold">Reservado para pickup por vehículo en tránsito</p>
            <p className="text-sky-700 dark:text-sky-300 mt-0.5">
              Vehículo <strong>{reservedTrip.license_plate}</strong> proveniente de{" "}
              <strong>{branchLabelById(reservedTrip.origin_branch_id, branches)}</strong> pasará a levantarlo.
              No requiere acción de esta sucursal.
            </p>
            <button
              type="button"
              onClick={() => navigate(`/?view=trip&trip_id=${encodeURIComponent(reservedTrip.id)}`)}
              className="mt-2 text-xs font-semibold text-sky-800 dark:text-sky-300 hover:underline cursor-pointer"
            >
              Ver envíos del viaje {reservedTrip.id} →
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          ALERT BANNERS
          ═══════════════════════════════════════════════════════ */}
      {shipment.parent_shipment_id && (
        <AlertBanner variant="warning" icon={<Undo2 className="size-[18px]" />} className="mb-4">
          Este es un <strong>contra-envío</strong> generado a partir de{" "}
          <a href={`/shipments/${shipment.parent_shipment_id}`} className="font-bold underline">
            {shipment.parent_shipment_id}
          </a>
        </AlertBanner>
      )}

      {shipment.is_returning && (
        <AlertBanner variant="info" icon={<Undo2 className="size-[18px]" />} className="mb-4">
          Este envío está en <strong>modo devolución</strong>
        </AlertBanner>
      )}

      {reservedTrip && (
        <AlertBanner variant="info" icon={<Truck className="size-[18px]" />} className="mb-4">
          <p className="font-semibold m-0">Reservado para pickup por vehículo en tránsito</p>
          <p className="text-sm mt-0.5 opacity-90 m-0">
            Vehículo <strong>{reservedTrip.license_plate}</strong> proveniente de{" "}
            <strong>{branchLabelById(reservedTrip.origin_branch_id, branches)}</strong> pasará a levantarlo.
            No requiere acción de esta sucursal.
          </p>
        </AlertBanner>
      )}

      {!shipment.is_returning && (shipment.delivery_attempts ?? 0) > 0 && (() => {
        const attempts = shipment.delivery_attempts ?? 0;
        const atLimit = attempts >= maxDeliveryAttempts;
        return (
          <AlertBanner variant={atLimit ? "danger" : "warning"} className="mb-4">
            Intentos de entrega fallidos: <strong>{attempts}/{maxDeliveryAttempts}</strong>
            {atLimit && " — límite alcanzado, no se puede reintentar"}
          </AlertBanner>
        );
      })()}

      {shipment.status === "draft" && branchCapacity != null && branchCapacity.current >= branchCapacity.max_capacity && (
        <AlertBanner variant="warning" className="mb-4">
          <strong>La sucursal receptora está al límite de capacidad</strong>
          <p className="text-sm mt-0.5 opacity-90 m-0">
            {branchCapacity.current} de {branchCapacity.max_capacity} bultos ({branchCapacity.percentage}% de ocupación). Podés confirmar el envío, pero la sucursal estará por encima de su capacidad.
          </p>
        </AlertBanner>
      )}

      {shipment.status === "pending_payment" && (
        <PendingPaymentPanel
          trackingId={shipment.tracking_id}
          onBackToDraft={() => navigate("/?status=pending")}
        />
      )}

      {/* ═══════════════════════════════════════════════════════
          DRAFT MODE — edit form
          ═══════════════════════════════════════════════════════ */}
      {shipment.status === "draft" && draftForm ? (
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
        <>
          {/* ═══════════════════════════════════════════════════════
              B. TWO-COLUMN GRID
              ═══════════════════════════════════════════════════════ */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 lg:gap-8 items-start">

            {/* ── C1. LEFT COLUMN ── */}
            <div className="min-w-0">
              <InfoCards shipment={shipment} branches={branches} events={events} isMobile={isMobile} />

              {/* Zone actions */}
              {shipment.current_zone && hasRole("operator", "supervisor") && !operatorOutOfBranch && (
                <div className="bg-[var(--ok-bg)] border border-[var(--ok-border)] rounded-xl p-4 mb-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[13px] font-semibold text-[var(--ok-text)]">
                      Zona actual: <ZoneBadge zone={shipment.current_zone} />
                    </span>
                    {shipment.current_zone === "entrada" && (
                      <>
                        <Button size="sm" variant="outline" onClick={async () => { setMoving(true); try { await shipmentApi.moveZone(shipment.tracking_id, "salida"); reload(); } catch { setMoving(false); } finally { setMoving(false); } }} disabled={moving} className="border-[var(--ok)] text-[var(--ok-text)] hover:bg-[var(--ok-bg)]">
                          Mover a Salida
                        </Button>
                        <Button size="sm" variant="outline" onClick={async () => { const m = prompt("Motivo (opcional):"); setMoving(true); try { await shipmentApi.moveZone(shipment.tracking_id, "revision", m ?? undefined); reload(); } catch { setMoving(false); } finally { setMoving(false); } }} disabled={moving} className="border-[var(--warn)] text-[var(--warn-text)] hover:bg-[var(--warn-bg)]">
                          Mover a Revisión
                        </Button>
                      </>
                    )}
                    {shipment.current_zone === "salida" && (
                      <>
                        <Button size="sm" variant="outline" onClick={async () => { setMoving(true); try { await shipmentApi.moveZone(shipment.tracking_id, "revision"); reload(); } catch { setMoving(false); } finally { setMoving(false); } }} disabled={moving} className="border-[var(--warn)] text-[var(--warn-text)] hover:bg-[var(--warn-bg)]">
                          Mover a Revisión
                        </Button>
                        <Button size="sm" variant="outline" onClick={async () => { setMoving(true); try { await shipmentApi.moveZone(shipment.tracking_id, "entrada"); reload(); } catch { setMoving(false); } finally { setMoving(false); } }} disabled={moving} className="border-[var(--brand)] dark:border-blue-400 text-[var(--brand)] dark:text-blue-400 hover:bg-[var(--brand-tint)]">
                          Reingresar a Entrada
                        </Button>
                      </>
                    )}
                    {shipment.current_zone === "revision" && hasRole("supervisor") && (
                      <>
                        <Button size="sm" variant="outline" onClick={async () => { setMoving(true); try { await shipmentApi.approveFromRevision(shipment.tracking_id); reload(); } catch { setMoving(false); } finally { setMoving(false); } }} disabled={moving} className="border-[var(--ok)] text-[var(--ok-text)] hover:bg-[var(--ok-bg)]">
                          Aprobar (→ Salida)
                        </Button>
                        <Button size="sm" variant="outline" onClick={async () => { const c = prompt("Clasificación: lost (extraviado) o destroyed (daño total)"); if (!c || !["lost", "destroyed"].includes(c)) return; const m = prompt("Motivo (opcional):") ?? ""; setMoving(true); try { await shipmentApi.classifyShipment(shipment.tracking_id, c as "lost" | "destroyed", m); reload(); } catch { setMoving(false); } finally { setMoving(false); } }} disabled={moving} className="border-red-600 dark:border-red-400 text-[var(--danger-text)] hover:bg-[var(--danger-bg)]">
                          Clasificar (Perdido/Destruido)
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Fleet notices */}
              {(shipment.status === "loaded" || shipment.status === "in_transit") && hasRole("supervisor", "operator") && !operatorOutOfBranch && (
                <AlertBanner variant="info" className="mb-4">
                  {shipment.status === "loaded"
                    ? "Este envío está cargado en un vehículo esperando que se inicie el viaje. El estado se controla desde la página de Flota."
                    : "Este envío está en tránsito. El estado se actualizará automáticamente cuando el vehículo complete el viaje."}
                </AlertBanner>
              )}

              {/* Status update form */}
              {nextStatuses.length > 0 && hasRole("supervisor", "operator") && !operatorOutOfBranch && (
                <StatusUpdateForm
                  nextStatuses={nextStatuses}
                  newStatus={newStatus}
                  onStatusSelect={(s) => {
                    if (s === "loaded") {
                      openVehiclePicker(shipment);
                    } else {
                      setNewStatus(s);
                      if (s === "out_for_delivery") {
                        usersApi.listDrivers(shipment.current_location ?? shipment.receiving_branch_id, "last_mile").then(setDrivers);
                      }
                    }
                  }}
                  selectedDriverId={selectedDriverId}
                  onDriverChange={setSelectedDriverId}
                  drivers={drivers}
                  recipientDni={recipientDni}
                  onRecipientDniChange={setRecipientDni}
                  senderDni={senderDni}
                  onSenderDniChange={setSenderDni}
                  notes={notes}
                  onNotesChange={setNotes}
                  updating={statusOptimistic.isPending}
                  updateError={updateError}
                  onSubmit={handleUpdateStatus}
                  shipment={shipment}
                  events={events}
                  branches={branches}
                  statusLabels={STATUS_LABELS}
                />
              )}

              {shipment.status === "delivered" && (
                <AlertBanner variant="success" className="mb-4">
                  Este envío fue entregado.
                </AlertBanner>
              )}

              {/* Route timeline */}
              <RouteTimeline
                events={events}
                origin={shipment.sender.address.city}
                receivingBranchId={shipment.origin_branch_id ?? shipment.receiving_branch_id}
                finalBranchId={shipment.final_branch_id}
                destination={shipment.recipient.address.city}
                branches={branches}
              />

              {/* Event history */}
              {shipment.status !== "draft" && (
                <EventTimeline events={events} branches={branches} showHeading className="mb-4" />
              )}
            </div>

            {/* ── D. RIGHT COLUMN (sidebar, sticky) ── */}
            <div className={isMobile ? "" : "sticky top-6"}>
              {shipment.price != null && shipment.status !== "draft" && (
                <PriceCard price={shipment.price} breakdown={shipment.price_breakdown} />
              )}

              <VehicleCard
                assignedVehicle={assignedVehicle}
                loadingVehicle={loadingVehicle}
                onShowDetail={() => setShowVehicleDetail(true)}
              />

              <IncidentsList incidents={incidents} />

              <CommentsList
                comments={comments}
                newComment={newComment}
                onNewCommentChange={setNewComment}
                addingComment={addingComment}
                canAdd={hasRole("supervisor", "admin", "operator") && shipment.status !== "delivered" && shipment.status !== "returned" && !operatorOutOfBranch}
                onAddComment={async () => {
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
              />
            </div>

          </div>{/* end two-column grid */}
        </>
      )}

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
      <Dialog open={showIncidentModal} onClose={() => setShowIncidentModal(false)}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader onClose={() => setShowIncidentModal(false)}>
            <DialogTitle>Registrar incidencia</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-2">
            {incidentError && (
              <AlertBanner variant="danger" className="mb-4">{incidentError}</AlertBanner>
            )}
            <div className="mb-4">
              <label className="block text-[13px] font-semibold text-[var(--text-strong)] mb-1.5">Tipo de incidencia</label>
              <select value={incidentType} onChange={(e) => setIncidentType(e.target.value as IncidentType)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-strong)] text-sm bg-[var(--bg-card)] text-[var(--text-primary)]">
                {(Object.entries(INCIDENT_TYPE_LABELS) as [IncidentType, string][]).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            {TERMINAL_INCIDENT_STATUS[incidentType] && (
              <AlertBanner variant="warning" className="mb-4">
                <strong>Atención:</strong> Al confirmar esta incidencia, el envío quedará en estado <strong>{incidentType === "extraviado" ? "Extraviado" : "Daño total"}</strong> y no podrá continuar su flujo. Esta acción es irreversible.
              </AlertBanner>
            )}
            <div className="mb-4">
              <label className="block text-[13px] font-semibold text-[var(--text-strong)] mb-1.5">Descripción</label>
              <textarea value={incidentDescription} onChange={(e) => setIncidentDescription(e.target.value)}
                placeholder="Describí el problema detectado..." rows={4}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-strong)] text-sm resize-y font-[inherit] bg-[var(--bg-card)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowIncidentModal(false)}>Cancelar</Button>
            <Button
              variant={TERMINAL_INCIDENT_STATUS[incidentType] ? "destructive" : "default"}
              disabled={reportingIncident || !incidentDescription.trim()}
              onClick={async () => {
                if (!incidentDescription.trim()) return;
                setReportingIncident(true);
                setIncidentError("");
                try {
                  await shipmentApi.reportIncident(trackingId!, incidentType, incidentDescription.trim());
                  setShowIncidentModal(false);
                  const [incs, s] = await Promise.all([shipmentApi.getIncidents(trackingId!), shipmentApi.get(trackingId!)]);
                  setIncidents(incs ?? []);
                  setShipment(s);
                } catch (err: unknown) {
                  setIncidentError(extractErrorMessage(err) ?? "Error al registrar la incidencia.");
                } finally {
                  setReportingIncident(false);
                }
              }}
            >
              {reportingIncident ? "Registrando..." : TERMINAL_INCIDENT_STATUS[incidentType] ? "Confirmar y cerrar envío" : "Confirmar registro"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vehicle picker modal for loaded */}
      <Dialog open={showVehiclePicker} onClose={() => setShowVehiclePicker(false)}>
        <DialogContent className="max-w-[520px]">
          <DialogHeader onClose={() => setShowVehiclePicker(false)}>
            <DialogTitle>Asignar vehículo — Cargar en vehículo</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-2">
            <p className="text-[13px] text-[var(--text-secondary)] mb-4">
              Seleccioná un vehículo disponible en esta sucursal. Peso del envío: <strong>{shipment ? effectiveWeightKg(shipment) : 0} kg</strong>.
            </p>
            {vehiclePickerError && <AlertBanner variant="danger" className="mb-4">{vehiclePickerError}</AlertBanner>}
            {loadingVehicles ? (
              <p className="text-[var(--text-secondary)] text-[13px] py-4">Cargando vehículos disponibles...</p>
            ) : availableVehicles.length === 0 ? (
              <p className="text-[var(--text-secondary)] text-[13px] py-4">No hay vehículos disponibles en esta sucursal con capacidad suficiente.</p>
            ) : (
              <div className="flex flex-col gap-2 mb-4">
                {availableVehicles.map((v) => {
                  const remainingKg = v.capacity_kg;
                  const isSelected = selectedVehiclePlate === v.license_plate;
                  return (
                    <div key={v.license_plate} onClick={() => setSelectedVehiclePlate(v.license_plate)}
                      className={`flex items-center gap-3 rounded-lg px-3.5 py-3 cursor-pointer transition-colors duration-200 ${
                        isSelected ? "border-2 border-[var(--brand)] bg-[var(--brand-tint)]" : "border border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--border-strong)]"}`}>
                      <div className="flex-1">
                        <p className="m-0 font-bold text-[15px] text-[var(--text-primary)]">{v.license_plate}</p>
                        <p className="mt-0.5 mb-0 text-xs text-[var(--text-secondary)]">
                          {v.type === "auto" ? "Auto" : v.type === "furgoneta" ? "Furgoneta" : "Camión"}
                          {" · "}Capacidad disponible: {remainingKg.toFixed(0)} kg
                          {(v.assigned_shipments ?? []).length > 0 && ` · ${v.assigned_shipments!.length} envío(s) cargado(s)`}
                        </p>
                      </div>
                      {isSelected && <span className="text-[var(--text-heading)] font-bold text-lg">✓</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowVehiclePicker(false)}>Cancelar</Button>
            <Button onClick={handleAssignVehicle} disabled={!selectedVehiclePlate || assigningVehicle}>
              {assigningVehicle ? "Asignando..." : "Asignar vehículo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showVehicleDetail && assignedVehicle && (
        <VehicleDetailModal
          vehicle={assignedVehicle}
          onClose={() => setShowVehicleDetail(false)}
          onRefresh={() => loadAssignedVehicle(trackingId!)}
        />
      )}

      <Dialog open={showCancelModal} onClose={() => setShowCancelModal(false)}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-[var(--danger-text)]">Cancelar envío</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-2">
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Esta acción es irreversible. El envío pasará a <strong>Cancelado</strong> y no podrá continuar en tránsito.
            </p>
            <label className="text-xs font-semibold text-[var(--text-strong)] block mb-1.5">Motivo de cancelación *</label>
            <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Describí el motivo de la cancelación..." rows={4}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-strong)] text-sm resize-y font-[inherit] bg-[var(--bg-card)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all" />
            {cancelError && <AlertBanner variant="danger" className="mt-3">{cancelError}</AlertBanner>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancelModal(false)} disabled={cancelling}>Volver</Button>
            <Button variant="destructive" onClick={handleCancel} disabled={cancelling || !cancelReason.trim()}>
              {cancelling ? "Cancelando..." : "Confirmar cancelación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    <Dialog open onClose={onClose}>
      <DialogContent className="max-w-[680px]">
        <DialogHeader onClose={onClose}>
          <DialogTitle>Corregir datos del envío</DialogTitle>
        </DialogHeader>
        <div className="px-6 pb-2">
          <p className="text-[13px] text-[var(--text-secondary)] mb-4">
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

        {error && <AlertBanner variant="danger" className="mt-3">{error}</AlertBanner>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Guardando..." : "Guardar correcciones"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      const msg = extractErrorMessage(e);
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
