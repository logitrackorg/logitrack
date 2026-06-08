import type { PackageType, ShipmentType, TimeWindow, DeliveryMethod } from "./api/shipments";

export const PROVINCES = [
  "Buenos Aires", "Catamarca", "Chaco", "Chubut", "Ciudad de Buenos Aires", "Córdoba", "Corrientes",
  "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza",
  "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis",
  "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán",
];

export const PACKAGE_TYPES: { value: PackageType; label: string }[] = [
  { value: "envelope", label: "Sobre" },
  { value: "box",      label: "Caja" },
];

export const SHIPMENT_TYPES: { value: ShipmentType; label: string }[] = [
  { value: "normal",  label: "Normal" },
  { value: "express", label: "Express" },
];

export const TIME_WINDOWS: { value: TimeWindow; label: string }[] = [
  { value: "flexible",  label: "Flexible" },
  { value: "morning",   label: "Mañana (8-12)" },
  { value: "afternoon", label: "Tarde (12-18)" },
];

export const DELIVERY_METHODS: { value: DeliveryMethod; label: string; description: string }[] = [
  { value: "ultima_milla",    label: "Última milla", description: "Entrega a domicilio del destinatario (≤ 50 km de la sucursal final)" },
  { value: "retiro_sucursal", label: "Retiro en sucursal", description: "El destinatario retira el envío en la sucursal de destino" },
];
