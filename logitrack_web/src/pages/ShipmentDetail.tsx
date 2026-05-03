import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
import { useAuth } from "../context/AuthContext";
import { branchApi, branchLabel, branchLabelById, type Branch, type BranchCapacity } from "../api/branches";
import { customerApi, type Customer } from "../api/customers";
import { fmtDate, fmtDateTime } from "../utils/date";
import { useIsMobile } from "../hooks/useIsMobile";
import ShipmentQRModal from '../components/ShipmentQRModal';
import { qrService, type QRResponse } from '../api/qrService';
import { printShipmentDocument } from '../utils/printShipmentDocument';
import { organizationApi, type OrganizationConfig } from '../api/organizationApi';
import { systemConfigApi } from '../api/systemConfig';

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
};

const STATUS_LABELS: Record<ShipmentStatus, string> = {
  draft:                "Borrador",
  at_origin_hub:        "En sucursal de origen",
  loaded:               "Cargado",
  in_transit:           "En tránsito",
  at_hub:               "En sucursal",
  out_for_delivery:     "En reparto",
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
};

const PACKAGE_LABELS: Record<string, string> = {
  envelope: "Sobre", box: "Caja", pallet: "Pallet",
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
  const [savingDraft, setSavingDraft] = useState(false);
  const [saveDraftError, setSaveDraftError] = useState("");
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

  // Estados para impresión de alta
  const [printingDoc, setPrintingDoc] = useState(false);
  const [printDocError, setPrintDocError] = useState('');
  const [orgConfig, setOrgConfig] = useState<OrganizationConfig | null>(null);
  const [maxDeliveryAttempts, setMaxDeliveryAttempts] = useState(3);
  const [branchCapacity, setBranchCapacity] = useState<BranchCapacity | null>(null);

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
          cold_chain: s.cold_chain ?? false,
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
        const usedKg = (v.assigned_shipments ?? []).reduce((acc: number) => acc, 0);
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
    if (shipment?.status === "draft" && shipment.receiving_branch_id) {
      branchApi.getCapacity(shipment.receiving_branch_id).then(setBranchCapacity).catch(() => {});
    } else {
      setBranchCapacity(null);
    }
  }, [shipment?.status, shipment?.receiving_branch_id]);

  const handleSaveDraftChanges = async () => {
    if (!trackingId || !draftForm) return;
    if (!draftForm.sender.name) { setSaveDraftError("El nombre del remitente es obligatorio."); return; }
    if (!draftForm.recipient.name) { setSaveDraftError("El nombre del destinatario es obligatorio."); return; }
    setSavingDraft(true);
    setSaveDraftError("");
    try {
      await shipmentApi.updateDraft(trackingId, draftForm);
      navigate("/?status=draft");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSaveDraftError(msg ?? "No se pudieron guardar los cambios.");
    } finally {
      setSavingDraft(false);
    }
  };

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
      const confirmed = await shipmentApi.confirmDraft(trackingId, user!.username);
      navigate(`/shipments/${confirmed.tracking_id}`, { replace: true });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setConfirmError(msg ?? "No se pudo confirmar el envío.");
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
      weight_kg: c.weight_kg ?? String(shipment.weight_kg ?? ""),
      package_type: c.package_type ?? shipment.package_type ?? "",
      special_instructions: c.special_instructions ?? shipment.special_instructions ?? "",
      shipment_type: c.shipment_type ?? shipment.shipment_type ?? "normal",
      time_window: c.time_window ?? shipment.time_window ?? "flexible",
      cold_chain: c.cold_chain ?? (shipment.cold_chain ? "true" : "false"),
      is_fragile: c.is_fragile ?? (shipment.is_fragile ? "true" : "false"),
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
      shipment_type: c.shipment_type ?? shipment.shipment_type ?? "normal",
      time_window: c.time_window ?? shipment.time_window ?? "flexible",
      cold_chain: c.cold_chain ?? (shipment.cold_chain ? "true" : "false"),
      is_fragile: c.is_fragile ?? (shipment.is_fragile ? "true" : "false"),
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
    if (!correctionForm.weight_kg || parseFloat(correctionForm.weight_kg) <= 0) { setCorrectionError("El peso debe ser mayor a 0."); return; }
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
    <div style={{ padding: 24 }}>
      <p style={{ color: "#ef4444" }}>{error}</p>
      <button onClick={() => navigate("/")} style={backBtn}>← Back to list</button>
    </div>
  );

  if (!shipment) return <div style={{ padding: 24 }}>Cargando...</div>;

  const isAtOriginBranch = shipment.current_location === shipment.receiving_branch_id;
  const nextStatuses = TRANSITIONS[shipment.status].filter(
    (s) => s !== "ready_for_return" || (shipment.is_returning && isAtOriginBranch)
  ).filter(
    (s) => !shipment.is_returning || (s !== "out_for_delivery" && s !== "ready_for_pickup")
  ).filter(
    () => !(hasRole("operator", "supervisor") && shipment.status === "out_for_delivery")
  ).filter(
    (s) => s !== "redelivery_scheduled" || (shipment.delivery_attempts ?? 0) < maxDeliveryAttempts
  );
  const fmt = fmtDateTime;
  const fmtAddr = (a: { street?: string; city: string; province: string; postal_code?: string }) =>
    [a.street, a.city, a.province, a.postal_code].filter(Boolean).join(", ");

  const operatorOutOfBranch = (user?.role === "operator" || user?.role === "supervisor") && !!user.branch_id && user.branch_id !== shipment?.receiving_branch_id;

  return (
    <div style={{ padding: isMobile ? 16 : "24px 32px" }}>
      <button onClick={() => navigate("/")} style={backBtn}>← Volver al listado</button>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "720px 300px", gap: isMobile ? 16 : 32, alignItems: "start", marginTop: 16 }}>

      {/* ── Left column ── */}
      <div>
      <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>
          <code style={{ fontSize: 22 }}>{shipment.tracking_id}</code>
        </h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <PriorityBadge priority={shipment.priority} />
          {hasRole("supervisor", "admin", "operator") && shipment.status !== "draft" && shipment.status !== "delivered" && shipment.status !== "returned" && shipment.status !== "cancelled" && !operatorOutOfBranch && (
            <button onClick={openCorrectionModal} style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#374151" }}>
              ✏️ Editar datos
            </button>
          )}
          {hasRole("operator", "supervisor", "admin") && !["draft", "delivered", "returned", "cancelled", "lost", "destroyed"].includes(shipment.status) && !operatorOutOfBranch && (
            <button
              onClick={() => { setShowIncidentModal(true); setIncidentError(""); setIncidentDescription(""); setIncidentType("extraviado"); }}
              style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#92400e" }}>
              ⚠ Registrar incidencia
            </button>
          )}
          {hasRole("supervisor", "admin") && ["at_origin_hub", "at_hub", "ready_for_pickup"].includes(shipment.status) && !operatorOutOfBranch && (
            <button onClick={() => { setCancelReason(""); setCancelError(""); setShowCancelModal(true); }}
              style={{ background: "#fff", border: "1px solid #fca5a5", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#b91c1c" }}>
              Cancelar envío
            </button>
          )}
          <StatusBadge status={shipment.status} />
        </div>
      </div>
      {/* Banner: contra-envío */}
      {shipment.parent_shipment_id && (
        <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#92400e" }}>
          ↩️ Este es un <strong>contra-envío</strong> generado a partir de{" "}
          <a href={`/shipments/${shipment.parent_shipment_id}`} style={{ color: "#92400e", fontWeight: 700 }}>
            {shipment.parent_shipment_id}
          </a>
        </div>
      )}

      {/* Banner: modo devolución */}
      {shipment.is_returning && (
        <div style={{ background: "#ede9fe", border: "1px solid #c4b5fd", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#5b21b6" }}>
          ↩️ Este envío está en <strong>modo devolución</strong>
        </div>
      )}

      {/* Contador de intentos de entrega */}
      {!shipment.is_returning && (shipment.delivery_attempts ?? 0) > 0 && (() => {
        const attempts = shipment.delivery_attempts ?? 0;
        const atLimit = attempts >= maxDeliveryAttempts;
        return (
          <div style={{
            background: atLimit ? "#fef2f2" : "#fffbeb",
            border: `1px solid ${atLimit ? "#fecaca" : "#fcd34d"}`,
            borderRadius: 8, padding: "10px 14px", marginBottom: 14,
            fontSize: 13, color: atLimit ? "#b91c1c" : "#92400e",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <span>{atLimit ? "🚫" : "⚠️"}</span>
            <span>
              Intentos de entrega fallidos:{" "}
              <strong>{attempts}/{maxDeliveryAttempts}</strong>
              {atLimit && " — límite alcanzado, no se puede reintentar"}
            </span>
          </div>
        );
      })()}

      {shipment.status === "draft" && branchCapacity != null && branchCapacity.current >= branchCapacity.max_capacity && (
        <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, padding: "12px 16px", marginBottom: 14, fontSize: 13, color: "#92400e" }}>
          <strong>⚠️ La sucursal receptora está al límite de capacidad</strong>
          <div style={{ marginTop: 4, color: "#78350f" }}>
            {branchCapacity.current} de {branchCapacity.max_capacity} bultos ({branchCapacity.percentage}% de ocupación). Podés confirmar el envío, pero la sucursal estará por encima de su capacidad.
          </div>
        </div>
      )}

      {shipment.status === "draft" && draftForm ? (
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
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 16 }}>
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
                  {shipment.cold_chain && <InfoRow label="Cadena de frío" value="Sí" />}
                  {shipment.shipment_type && <InfoRow label="Tipo de envío" value={shipment.shipment_type === "express" ? "Express" : "Normal"} />}
                  {shipment.time_window && <InfoRow label="Ventana horaria" value={shipment.time_window === "morning" ? "Mañana" : shipment.time_window === "afternoon" ? "Tarde" : "Flexible"} />}
                  {shipment.priority && <InfoRow label="Prioridad" value={<PriorityBadge priority={shipment.priority} />} />}
                  <InfoRowEx value={weightVal.corrected ? `${cor.weight_kg} kg` : `${shipment.weight_kg} kg`} original={`${shipment.weight_kg} kg`} corrected={weightVal.corrected} label="Peso" />
                  {(shipment.special_instructions || cor.special_instructions) && <InfoRowEx {...instrVal} label="Instrucciones" />}
                </Card>
                <Card title="Fechas y ubicación">
                  <InfoRow label="Creado"          value={fmt(shipment.created_at)} />
                  <InfoRow label="Entrega est."    value={fmt(shipment.estimated_delivery_at)} />
                  {shipment.delivered_at && <InfoRow label="Entregado" value={fmt(shipment.delivered_at)} />}
                  {shipment.current_location && (
                    <InfoRow label="Ubicación actual" value={`📍 ${branchLabelById(shipment.current_location, branches)}`} />
                  )}
                </Card>
              </>;
            })()}
          </div>
          <RouteTimeline events={events} origin={shipment.sender.address.city} receivingBranchId={shipment.origin_branch_id ?? shipment.receiving_branch_id} destination={shipment.recipient.address.city} branches={branches} />
        </>
      )}

 {/*  BOTÓN GENERAR QR */}
{shipment.status !== "draft" && (
  <button
    onClick={handleGenerateQR}
    disabled={!shipment.tracking_id || generatingQR}
    title={!shipment.tracking_id ? "Solo disponible para envíos confirmados" : "Generar código QR"}
    style={{
      background: "#fff",
      border: "1px solid #d1d5db",
      borderRadius: 6,
      padding: "6px 12px",
      cursor: (!shipment.tracking_id || generatingQR) ? "not-allowed" : "pointer",
      fontSize: 13,
      fontWeight: 600,
      color: "#374151",
      opacity: (!shipment.tracking_id || generatingQR) ? 0.5 : 1,
    }}
  >
    {generatingQR ? "Generando..." : "📱 Generar QR"}
  </button>
)}

{/* BOTÓN IMPRIMIR ALTA — CA-1, CA-2, CA-3, CA-4 */}
{hasRole("operator", "supervisor", "admin") && shipment.status !== "draft" && (
  <button
    onClick={handlePrintDocument}
    disabled={printingDoc}
    title="Imprimir comprobante de alta del envío"
    style={{
      background: "#fff",
      border: "1px solid #d1d5db",
      borderRadius: 6,
      padding: "6px 12px",
      cursor: printingDoc ? "not-allowed" : "pointer",
      fontSize: 13,
      fontWeight: 600,
      color: "#374151",
      opacity: printingDoc ? 0.5 : 1,
    }}
  >
    {printingDoc ? "Generando..." : "🖨️ Imprimir alta"}
  </button>
)}

      {/* Status update — supervisor y operador (no admin) */}
      {(shipment.status === "loaded" || shipment.status === "in_transit") && hasRole("supervisor", "operator") && !operatorOutOfBranch && (
        <div style={{ ...cardStyle, marginBottom: 16, background: "#eff6ff", border: "1px solid #bfdbfe" }}>
          <p style={{ margin: 0, fontSize: 13, color: "#1d4ed8" }}>
            {shipment.status === "loaded"
              ? "Este envío está cargado en un vehículo esperando que se inicie el viaje. El estado se controla desde la página de Flota."
              : "Este envío está en tránsito. El estado se actualizará automáticamente cuando el vehículo complete el viaje."}
          </p>
        </div>
      )}

      {nextStatuses.length > 0 && hasRole("supervisor", "operator") && !operatorOutOfBranch && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <h2 style={{ fontSize: "1rem", margin: "0 0 14px" }}>Actualizar estado</h2>
          <form onSubmit={handleUpdateStatus} style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {nextStatuses.map((s) => (
                <button key={s} type="button" onClick={() => {
                  if (s === "loaded") {
                    openVehiclePicker(shipment);
                  } else {
                    setNewStatus(s);
                    if (s === "out_for_delivery") {
                      usersApi.listDrivers(shipment.current_location ?? shipment.receiving_branch_id).then(setDrivers);
                    }
                  }
                }}
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
            {newStatus === "out_for_delivery" && (
              <select
                value={selectedDriverId}
                onChange={(e) => setSelectedDriverId(e.target.value)}
                required
                style={inputStyle}
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
                style={inputStyle}
              />
            )}
            {newStatus === "returned" && !shipment.parent_shipment_id && (
              <input
                value={senderDni}
                onChange={(e) => setSenderDni(e.target.value)}
                placeholder="DNI del remitente (obligatorio)"
                required
                style={inputStyle}
              />
            )}
            {newStatus === "returned" && !!shipment.parent_shipment_id && (
              <input
                value={recipientDni}
                onChange={(e) => setRecipientDni(e.target.value)}
                placeholder="DNI del destinatario -remitente original- (obligatorio)"
                required
                style={inputStyle}
              />
            )}
            {newStatus === "at_hub" && shipment.status === "delivery_failed" && (() => {
              const returnLocation = [...events].reverse().find(ev => ev.to_status === "at_hub")?.location;
              return returnLocation ? (
                <p style={{ margin: 0, fontSize: 13, color: "#4b5563" }}>
                  Devolviendo a: <strong>{branchLabel(returnLocation, branches)}</strong>
                </p>
              ) : null;
            })()}
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder={newStatus === "delivery_failed" ? "Motivo obligatorio (ej: destinatario ausente)" : "Notas (opcional)"}
              required={newStatus === "delivery_failed"}
              style={inputStyle} />
            {newStatus === "delivery_failed" && !notes.trim() && (
              <p style={{ margin: 0, fontSize: 12, color: "#dc2626" }}>El motivo es obligatorio para registrar un intento fallido.</p>
            )}
            {newStatus === "delivered" && !recipientDni.trim() && (
              <p style={{ margin: 0, fontSize: 12, color: "#dc2626" }}>El DNI del destinatario es obligatorio para marcar como entregado.</p>
            )}
            {newStatus === "returned" && !shipment.parent_shipment_id && !senderDni.trim() && (
              <p style={{ margin: 0, fontSize: 12, color: "#dc2626" }}>El DNI del remitente es obligatorio para registrar la devolución.</p>
            )}
            {newStatus === "returned" && !!shipment.parent_shipment_id && !recipientDni.trim() && (
              <p style={{ margin: 0, fontSize: 12, color: "#dc2626" }}>El DNI del destinatario es obligatorio para registrar la devolución.</p>
            )}
            {updateError && <p style={{ color: "#ef4444", margin: 0, fontSize: 13 }}>{updateError}</p>}
            {(() => {
              const returnedDniMissing = newStatus === "returned" && (shipment.parent_shipment_id ? !recipientDni.trim() : !senderDni.trim());
              const disabled = !newStatus || updating || (newStatus === "delivery_failed" && !notes.trim()) || (newStatus === "out_for_delivery" && !selectedDriverId) || (newStatus === "delivered" && !recipientDni.trim()) || returnedDniMissing;
              return (
            <button type="submit"
              disabled={disabled}
              style={{
                background: !disabled ? "#1e3a5f" : "#e5e7eb",
                color: !disabled ? "#fff" : "#9ca3af",
                border: "none", borderRadius: 6, padding: "8px 16px",
                cursor: (newStatus && !updating && !(newStatus === "delivery_failed" && !notes.trim()) && !(newStatus === "out_for_delivery" && !selectedDriverId) && !(newStatus === "delivered" && !recipientDni.trim()) && !(newStatus === "returned" && !senderDni.trim())) ? "pointer" : "default",
                fontWeight: 600, alignSelf: "start",
              }}>
              {updating ? "Actualizando..." : "Confirmar cambio"}
            </button>
              );
            })()}
          </form>
        </div>
      )}

      {shipment.status === "delivered" && (
        <div style={{ ...cardStyle, marginBottom: 16, background: "#d1fae5", border: "1px solid #6ee7b7" }}>
          <p style={{ margin: 0, color: "#065f46", fontWeight: 600 }}>Este envío fue entregado.</p>
        </div>
      )}

      {/* Event history */}
      <h2 style={{ fontSize: "1rem", marginBottom: 12 }}>Historial de eventos</h2>
      {events.length === 0 ? (
        <p style={{ color: "#6b7280", fontSize: 14 }}>Sin eventos registrados.</p>
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
                  <span>por <strong>{ev.changed_by || "sistema"}</strong></span>
                  {ev.location && (() => {
                    const b = branches.find(x => x.id === ev.location);
                    return (
                      <span>📍 <strong>{b?.name ?? ev.location}</strong>{b && <> · {b.address.city} · <span style={{ color: "#9ca3af" }}>{b.province}</span></>}</span>
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

      {/* ── Right column: Vehicle & Comments ── */}
      <div style={isMobile ? {} : { position: "sticky", top: 24 }}>
        {/* Vehicle Card */}
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <h2 style={{ fontSize: "1rem", margin: "0 0 12px" }}>Vehículo asignado</h2>
          {loadingVehicle ? (
            <p style={{ color: "#6b7280", fontSize: 13, margin: 0 }}>Cargando...</p>
          ) : assignedVehicle ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 10,
                  background: "#10b98120",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <svg style={{ width: 24, height: 24, color: "#10b981" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a1 1 0 100-2 1 1 0 000 2z" />
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <p
                    onClick={() => setShowVehicleDetail(true)}
                    style={{ fontSize: 16, fontWeight: 700, color: "#1e3a5f", margin: 0, cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted" }}
                  >
                    {assignedVehicle.license_plate}
                  </p>
                  <p style={{ fontSize: 12, color: "#6b7280", margin: "2px 0 0" }}>
                    {assignedVehicle.type === "motocicleta" ? "Motocicleta" : assignedVehicle.type === "auto" ? "Auto" : assignedVehicle.type === "furgoneta" ? "Furgoneta" : "Camión"} · {assignedVehicle.capacity_kg} kg
                  </p>
                </div>
                <div style={{
                  padding: "4px 10px", borderRadius: 9999,
                  background: "#10b98120",
                  fontSize: 11, fontWeight: 600, color: "#10b981",
                }}>
                  {assignedVehicle.status_label}
                </div>
              </div>
              <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
                  <div>
                    <span style={{ color: "#6b7280" }}>ID: </span>
                    <span style={{ fontWeight: 600, color: "#374151" }}>#{assignedVehicle.id}</span>
                  </div>
                  {assignedVehicle.updated_by && (
                    <div>
                      <span style={{ color: "#6b7280" }}>Por: </span>
                      <span style={{ fontWeight: 600, color: "#374151" }}>{assignedVehicle.updated_by}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <svg style={{ width: 32, height: 32, color: "#9ca3af", margin: "0 auto 8px" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a1 1 0 100-2 1 1 0 000 2z" />
              </svg>
              <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>Sin vehículo asignado</p>
            </div>
          )}
        </div>

        {/* Incidents Card */}
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <h2 style={{ fontSize: "1rem", margin: "0 0 12px" }}>Incidencias</h2>
          {incidents.length === 0 ? (
            <p style={{ color: "#6b7280", fontSize: 13, margin: 0 }}>Sin incidencias registradas.</p>
          ) : (
            <div style={{ display: "grid", gap: 8, maxHeight: 400, overflowY: "auto" }}>
              {incidents.map((inc) => (
                <div key={inc.id} style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, color: "#92400e", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 4, padding: "1px 7px", fontSize: 11 }}>
                      {INCIDENT_TYPE_LABELS[inc.incident_type] ?? inc.incident_type}
                    </span>
                    <span style={{ color: "#9ca3af", fontSize: 11, whiteSpace: "nowrap", marginLeft: 8 }}>{fmtDateTime(inc.created_at)}</span>
                  </div>
                  <p style={{ margin: "4px 0 0", color: "#374151", whiteSpace: "pre-wrap" as const }}>{inc.description}</p>
                  <p style={{ margin: "6px 0 0", color: "#9ca3af", fontSize: 11 }}>Reportado por: {inc.reported_by}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Comments Card */}
        <div style={{ ...cardStyle }}>
          <h2 style={{ fontSize: "1rem", margin: "0 0 12px" }}>Comentarios</h2>
          {hasRole("supervisor", "admin", "operator") && shipment.status !== "delivered" && shipment.status !== "returned" && !operatorOutOfBranch && (
            <div style={{ marginBottom: 12 }}>
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Agregar un comentario..."
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
                {addingComment ? "Agregando..." : "Agregar comentario"}
              </button>
            </div>
          )}
          {comments.length === 0 ? (
            <p style={{ color: "#6b7280", fontSize: 13, margin: 0 }}>Sin comentarios todavía.</p>
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

      {/* Incident report modal */}
      {showIncidentModal && trackingId && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setShowIncidentModal(false)}
        >
          <div
            style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 480, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 18, color: "#111827" }}>Registrar incidencia</h2>
              <button onClick={() => setShowIncidentModal(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>✕</button>
            </div>
            {incidentError && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", padding: "8px 12px", borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
                {incidentError}
              </div>
            )}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Tipo de incidencia</label>
              <select
                value={incidentType}
                onChange={(e) => setIncidentType(e.target.value as IncidentType)}
                style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, background: "#fff" }}
              >
                {(Object.entries(INCIDENT_TYPE_LABELS) as [IncidentType, string][]).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            {TERMINAL_INCIDENT_STATUS[incidentType] && (
              <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", color: "#92400e", padding: "10px 12px", borderRadius: 6, marginBottom: 14, fontSize: 13, lineHeight: 1.5 }}>
                <strong>Atención:</strong> Al confirmar esta incidencia, el envío quedará en estado <strong>{incidentType === "extraviado" ? "Extraviado" : "Daño total"}</strong> y no podrá continuar su flujo. Esta acción es irreversible.
              </div>
            )}
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Descripción</label>
              <textarea
                value={incidentDescription}
                onChange={(e) => setIncidentDescription(e.target.value)}
                placeholder="Describí el problema detectado..."
                rows={4}
                style={{ width: "100%", boxSizing: "border-box" as const, padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, fontFamily: "inherit", resize: "vertical" as const }}
              />
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowIncidentModal(false)}
                style={{ background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 6, padding: "8px 18px", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
                Cancelar
              </button>
              <button
                disabled={reportingIncident || !incidentDescription.trim()}
                onClick={async () => {
                  if (!incidentDescription.trim()) return;
                  setReportingIncident(true);
                  setIncidentError("");
                  try {
                    const terminalStatus = TERMINAL_INCIDENT_STATUS[incidentType];
                    await shipmentApi.reportIncident(trackingId, incidentType, incidentDescription.trim());
                    if (terminalStatus) {
                      await shipmentApi.updateStatus(trackingId, { status: terminalStatus, location: "", notes: incidentDescription.trim() });
                    }
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
                style={{ background: TERMINAL_INCIDENT_STATUS[incidentType] ? "#dc2626" : "#d97706", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", cursor: reportingIncident ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, opacity: reportingIncident || !incidentDescription.trim() ? 0.7 : 1 }}>
                {reportingIncident ? "Registrando..." : TERMINAL_INCIDENT_STATUS[incidentType] ? "Confirmar y cerrar envío" : "Confirmar registro"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vehicle picker modal for loaded */}
      {showVehiclePicker && shipment && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setShowVehiclePicker(false)}
        >
          <div
            style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 520, width: "100%", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 18, color: "#111827" }}>Asignar vehículo — Cargado</h2>
              <button onClick={() => setShowVehiclePicker(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>✕</button>
            </div>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "#6b7280" }}>
              Seleccioná un vehículo disponible en esta sucursal. Peso del envío: <strong>{effectiveWeightKg(shipment)} kg</strong>.
            </p>
            {vehiclePickerError && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", padding: "8px 12px", borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
                {vehiclePickerError}
              </div>
            )}
            {loadingVehicles ? (
              <p style={{ color: "#6b7280", fontSize: 13 }}>Cargando vehículos disponibles...</p>
            ) : availableVehicles.length === 0 ? (
              <p style={{ color: "#6b7280", fontSize: 13 }}>No hay vehículos disponibles en esta sucursal con capacidad suficiente.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
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
                      style={{
                        border: isSelected ? "2px solid #1e3a5f" : "1px solid #e5e7eb",
                        borderRadius: 8, padding: "12px 14px", cursor: "pointer",
                        background: isSelected ? "#e0eaff" : "#fff",
                        display: "flex", alignItems: "center", gap: 12,
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: "#111827" }}>{v.license_plate}</p>
                        <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7280" }}>
                          {v.type === "motocicleta" ? "Motocicleta" : v.type === "auto" ? "Auto" : v.type === "furgoneta" ? "Furgoneta" : "Camión"}
                          {" · "}Capacidad disponible: {remainingKg.toFixed(0)} kg
                          {(v.assigned_shipments ?? []).length > 0 && ` · ${v.assigned_shipments!.length} envío(s) cargado(s)`}
                        </p>
                      </div>
                      {isSelected && <span style={{ color: "#1e3a5f", fontWeight: 700 }}>✓</span>}
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowVehiclePicker(false)} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontWeight: 500 }}>
                Cancelar
              </button>
              <button
                onClick={handleAssignVehicle}
                disabled={!selectedVehiclePlate || assigningVehicle}
                style={{
                  padding: "8px 16px", borderRadius: 6, border: "none", fontWeight: 600, cursor: !selectedVehiclePlate || assigningVehicle ? "default" : "pointer",
                  background: !selectedVehiclePlate || assigningVehicle ? "#e5e7eb" : "#1e3a5f",
                  color: !selectedVehiclePlate || assigningVehicle ? "#9ca3af" : "#fff",
                }}
              >
                {assigningVehicle ? "Asignando..." : "Asignar vehículo"}
              </button>
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
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: "28px 32px", maxWidth: 440, width: "calc(100vw - 32px)", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 18, color: "#b91c1c" }}>Cancelar envío</h2>
            <p style={{ margin: "0 0 20px", fontSize: 14, color: "#6b7280" }}>
              Esta acción es irreversible. El envío pasará a <strong>Cancelado</strong> y no podrá continuar en tránsito.
            </p>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
              Motivo de cancelación *
            </label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Describí el motivo de la cancelación..."
              rows={4}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, boxSizing: "border-box", resize: "vertical" }}
            />
            {cancelError && <p style={{ color: "#ef4444", fontSize: 13, margin: "8px 0 0" }}>{cancelError}</p>}
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setShowCancelModal(false)} disabled={cancelling}
                style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 18px", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#374151" }}>
                Volver
              </button>
              <button type="button" onClick={handleCancel} disabled={cancelling || !cancelReason.trim()}
                style={{ background: cancelReason.trim() ? "#b91c1c" : "#fca5a5", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", cursor: cancelReason.trim() ? "pointer" : "not-allowed", fontSize: 14, fontWeight: 700 }}>
                {cancelling ? "Cancelando..." : "Confirmar cancelación"}
              </button>
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
        <div style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          background: "#fef2f2",
          border: "1px solid #fecaca",
          color: "#dc2626",
          padding: "12px 16px",
          borderRadius: 8,
          fontSize: 13,
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          zIndex: 1001,
        }}>
          {qrError}
        </div>
      )}
      {printDocError && (
        <div style={{
          position: "fixed",
          bottom: qrError ? 80 : 24,
          right: 24,
          background: "#fef2f2",
          border: "1px solid #fecaca",
          color: "#dc2626",
          padding: "12px 16px",
          borderRadius: 8,
          fontSize: 13,
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          zIndex: 1001,
        }}>
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
  { value: "pallet",   label: "Pallet" },
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
  const isMobile = useIsMobile();
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
    <div style={{ display: "grid", gap: 16, marginBottom: 16 }}>
      <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Creado: {createdAt}</p>

      {/* Remitente */}
      <fieldset style={fsStyle}>
        <legend style={legStyle}>Remitente</legend>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
          <DField label="Nombre *"><input style={inp} required value={form.sender.name ?? ""} onChange={(e) => setSender("name", e.target.value)} placeholder="Carlos Mendez" /></DField>
          <DField label="Teléfono *"><input style={inp} required value={form.sender.phone ?? ""} onChange={(e) => setSender("phone", e.target.value.replace(/\D/g, ""))} placeholder="5491112345678" /></DField>
          <DField label="Email"><input style={inp} type="email" value={form.sender.email ?? ""} onChange={(e) => setSender("email", e.target.value)} placeholder="opcional" /></DField>
          <DField label="DNI *">
            <input style={inp} required value={form.sender.dni ?? ""} onChange={(e) => handleSenderDNI(e.target.value)} placeholder="ej: 30123456" />
            {senderSuggestion && <CustomerSuggestion customer={senderSuggestion} onApply={applySenderSuggestion} onDismiss={() => setSenderSuggestion(null)} />}
          </DField>
          <DField label="Calle *"><input style={inp} required value={form.sender.address.street ?? ""} onChange={(e) => setSenderAddr("street", e.target.value)} placeholder="Av. Corrientes 1234" /></DField>
          <DField label="Ciudad *"><input style={inp} required value={form.sender.address.city ?? ""} onChange={(e) => setSenderAddr("city", e.target.value)} placeholder="Buenos Aires" /></DField>
          <DField label="Provincia *">
            <select style={inp} required value={form.sender.address.province ?? ""} onChange={(e) => setSenderAddr("province", e.target.value)}>
              <option value="">Seleccionar</option>
              {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </DField>
          <DField label="Código postal *"><input style={inp} required value={form.sender.address.postal_code ?? ""} onChange={(e) => setSenderAddr("postal_code", e.target.value)} placeholder="C1043" /></DField>
        </div>
      </fieldset>

      {/* Destinatario */}
      <fieldset style={fsStyle}>
        <legend style={legStyle}>Destinatario</legend>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
          <DField label="Nombre *"><input style={inp} required value={form.recipient.name ?? ""} onChange={(e) => setRecipient("name", e.target.value)} placeholder="Laura Gomez" /></DField>
          <DField label="Teléfono *"><input style={inp} required value={form.recipient.phone ?? ""} onChange={(e) => setRecipient("phone", e.target.value.replace(/\D/g, ""))} placeholder="5493516784321" /></DField>
          <DField label="Email"><input style={inp} type="email" value={form.recipient.email ?? ""} onChange={(e) => setRecipient("email", e.target.value)} placeholder="opcional" /></DField>
          <DField label="DNI *">
            <input style={inp} required value={form.recipient.dni ?? ""} onChange={(e) => handleRecipientDNI(e.target.value)} placeholder="ej: 28456789" />
            {recipientSuggestion && <CustomerSuggestion customer={recipientSuggestion} onApply={applyRecipientSuggestion} onDismiss={() => setRecipientSuggestion(null)} />}
          </DField>
          <DField label="Calle *"><input style={inp} required value={form.recipient.address.street ?? ""} onChange={(e) => setRecipientAddr("street", e.target.value)} placeholder="San Martín 456" /></DField>
          <DField label="Ciudad *"><input style={inp} required value={form.recipient.address.city ?? ""} onChange={(e) => setRecipientAddr("city", e.target.value)} placeholder="Córdoba" /></DField>
          <DField label="Provincia *">
            <select style={inp} required value={form.recipient.address.province ?? ""} onChange={(e) => setRecipientAddr("province", e.target.value)}>
              <option value="">Seleccionar</option>
              {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </DField>
          <DField label="Código postal *"><input style={inp} required value={form.recipient.address.postal_code ?? ""} onChange={(e) => setRecipientAddr("postal_code", e.target.value)} placeholder="X5000" /></DField>
        </div>
      </fieldset>

      {/* Paquete */}
      <fieldset style={fsStyle}>
        <legend style={legStyle}>Paquete</legend>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
          <DField label="Peso (kg) *">
            <input style={inp} type="number" step="0.1" min="0.1" required value={form.weight_kg || ""} onChange={(e) => set("weight_kg", parseFloat(e.target.value) || 0)} placeholder="3.5" />
          </DField>
          <DField label="Tipo de paquete *">
            <select style={inp} value={form.package_type ?? "box"} onChange={(e) => set("package_type", e.target.value)}>
              {PACKAGE_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </DField>
          <DField label="Tipo de envío">
            <select style={inp} value={form.shipment_type ?? "normal"} onChange={(e) => set("shipment_type", e.target.value)}>
              {SHIPMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </DField>
          <DField label="Ventana horaria">
            <select style={inp} value={form.time_window ?? "flexible"} onChange={(e) => set("time_window", e.target.value)}>
              {TIME_WINDOWS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </DField>
          <DField label="" style={{ gridColumn: "1 / -1" }}>
            <div style={{ display: "flex", gap: 20 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                <input type="checkbox" checked={!!form.is_fragile} onChange={(e) => set("is_fragile", e.target.checked)} />
                Contenido frágil (manipular con cuidado)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                <input type="checkbox" checked={!!form.cold_chain} onChange={(e) => set("cold_chain", e.target.checked)} />
                Cadena de frío (refrigerado)
              </label>
            </div>
          </DField>
          <DField label="Instrucciones especiales" style={{ gridColumn: "1 / -1" }}>
            <input style={inp} value={form.special_instructions ?? ""} onChange={(e) => set("special_instructions", e.target.value)} placeholder='ej: "Mantener vertical"' />
          </DField>
        </div>
      </fieldset>

      {/* Acciones */}
      <div style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 10, padding: "14px 18px" }}>
        <h2 style={{ fontSize: "1rem", margin: "0 0 8px", color: "#92400e" }}>Borrador — pendiente de confirmación</h2>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "#78350f" }}>
          Guardá los cambios antes de confirmar. Al confirmar se asignará un número de seguimiento y el envío ingresará al sistema logístico.
        </p>
        {saveError && <p style={{ color: "#ef4444", margin: "0 0 8px", fontSize: 13 }}>{saveError}</p>}
        {confirmError && <p style={{ color: "#ef4444", margin: "0 0 8px", fontSize: 13 }}>{confirmError}</p>}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onSave} disabled={saving || confirming}
            style={{ background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 18px", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
          <button onClick={onConfirm} disabled={saving || confirming}
            style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "8px 20px", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
            {confirming ? "Confirmando..." : "Confirmar envío"}
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
    draft: "#9ca3af", at_origin_hub: "#f59e0b", loaded: "#06b6d4", in_transit: "#3b82f6",
    at_hub: "#8b5cf6", out_for_delivery: "#f97316", delivery_failed: "#ef4444",
    redelivery_scheduled: "#fb923c", no_entregado: "#6b7280", rechazado: "#dc2626",
    delivered: "#10b981", ready_for_pickup: "#0891b2", ready_for_return: "#7c3aed",
    returned: "#6b7280", cancelled: "#b91c1c", lost: "#374151", destroyed: "#1f2937",
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
              <div style={{ fontSize: 11, color: "#f97316", fontWeight: 600, whiteSpace: "nowrap" as const }}>Destinatario</div>
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
            <div style={{ fontSize: 11, fontWeight: isDelivered ? 700 : 400, color: isDelivered ? "#065f46" : "#9ca3af", whiteSpace: "nowrap" as const }}>Destinatario</div>
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

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
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
  const isMobile = useIsMobile();
  const set = (key: string, value: string) => onChange({ ...form, [key]: value });
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 680, width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem", color: "#1e3a5f" }}>Corregir datos del envío</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280" }}>✕</button>
        </div>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "#6b7280" }}>
          Los datos originales no se modifican. Los cambios quedan registrados en el historial de comentarios.
        </p>

        {/* Remitente */}
        <fieldset style={fsStyle}>
          <legend style={legStyle}>Remitente</legend>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
            <DField label="Nombre"><input style={inp} value={form.sender_name ?? ""} onChange={(e) => set("sender_name", e.target.value)} /></DField>
            <DField label="Teléfono"><input style={inp} value={form.sender_phone ?? ""} onChange={(e) => set("sender_phone", e.target.value.replace(/\D/g, ""))} /></DField>
            <DField label="Email"><input style={inp} value={form.sender_email ?? ""} onChange={(e) => set("sender_email", e.target.value)} /></DField>
            <DField label="DNI"><input style={inp} value={form.sender_dni ?? ""} onChange={(e) => set("sender_dni", e.target.value)} /></DField>
            <DField label="Calle (origen)"><input style={inp} value={form.origin_street ?? ""} onChange={(e) => set("origin_street", e.target.value)} /></DField>
            <DField label="Ciudad (origen)"><input style={inp} value={form.origin_city ?? ""} onChange={(e) => set("origin_city", e.target.value)} /></DField>
            <DField label="Provincia (origen)">
              <select style={inp} value={form.origin_province ?? ""} onChange={(e) => set("origin_province", e.target.value)}>
                <option value="">Seleccionar</option>
                {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </DField>
            <DField label="Código postal (origen)"><input style={inp} value={form.origin_postal_code ?? ""} onChange={(e) => set("origin_postal_code", e.target.value)} /></DField>
          </div>
        </fieldset>

        {/* Destinatario */}
        <fieldset style={{ ...fsStyle, marginTop: 12 }}>
          <legend style={legStyle}>Destinatario</legend>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
            <DField label="Nombre"><input style={inp} value={form.recipient_name ?? ""} onChange={(e) => set("recipient_name", e.target.value)} /></DField>
            <DField label="Teléfono"><input style={inp} value={form.recipient_phone ?? ""} onChange={(e) => set("recipient_phone", e.target.value.replace(/\D/g, ""))} /></DField>
            <DField label="Email"><input style={inp} value={form.recipient_email ?? ""} onChange={(e) => set("recipient_email", e.target.value)} /></DField>
            <DField label="DNI"><input style={inp} value={form.recipient_dni ?? ""} onChange={(e) => set("recipient_dni", e.target.value)} /></DField>
            <DField label="Calle (destino)"><input style={inp} value={form.destination_street ?? ""} onChange={(e) => set("destination_street", e.target.value)} /></DField>
            <DField label="Ciudad (destino)"><input style={inp} value={form.destination_city ?? ""} onChange={(e) => set("destination_city", e.target.value)} /></DField>
            <DField label="Provincia (destino)">
              <select style={inp} value={form.destination_province ?? ""} onChange={(e) => set("destination_province", e.target.value)}>
                <option value="">Seleccionar</option>
                {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </DField>
            <DField label="Código postal (destino)"><input style={inp} value={form.destination_postal_code ?? ""} onChange={(e) => set("destination_postal_code", e.target.value)} /></DField>
          </div>
        </fieldset>

        {/* Paquete */}
        <fieldset style={{ ...fsStyle, marginTop: 12 }}>
          <legend style={legStyle}>Paquete</legend>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
            <DField label="Peso (kg)"><input style={inp} type="number" step="0.1" min="0" value={form.weight_kg ?? ""} onChange={(e) => set("weight_kg", e.target.value)} /></DField>
            <DField label="Tipo">
              <select style={inp} value={form.package_type ?? ""} onChange={(e) => set("package_type", e.target.value)}>
                {PACKAGE_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </DField>
            <DField label="Tipo de envío">
              <select style={inp} value={form.shipment_type ?? "normal"} onChange={(e) => set("shipment_type", e.target.value)}>
                {SHIPMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </DField>
            <DField label="Ventana horaria">
              <select style={inp} value={form.time_window ?? "flexible"} onChange={(e) => set("time_window", e.target.value)}>
                {TIME_WINDOWS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </DField>
            <DField label="Cadena de frío">
              <select style={inp} value={form.cold_chain ?? "false"} onChange={(e) => set("cold_chain", e.target.value)}>
                <option value="false">No</option>
                <option value="true">Sí (refrigerado)</option>
              </select>
            </DField>
            <DField label="Contenido frágil">
              <select style={inp} value={form.is_fragile ?? "false"} onChange={(e) => set("is_fragile", e.target.value)}>
                <option value="false">No</option>
                <option value="true">Sí (manipular con cuidado)</option>
              </select>
            </DField>
            <DField label="Instrucciones especiales" style={{ gridColumn: "1 / -1" }}>
              <input style={inp} value={form.special_instructions ?? ""} onChange={(e) => set("special_instructions", e.target.value)} />
            </DField>
          </div>
        </fieldset>

        {error && <p style={{ color: "#ef4444", fontSize: 13, margin: "12px 0 0" }}>{error}</p>}
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={onClose} disabled={saving} style={{ background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 18px", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
            Cancelar
          </button>
          <button onClick={onSave} disabled={saving} style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "8px 20px", cursor: saving ? "default" : "pointer", fontWeight: 700, fontSize: 14 }}>
            {saving ? "Guardando..." : "Guardar correcciones"}
          </button>
        </div>
      </div>
    </div>
  );
}
