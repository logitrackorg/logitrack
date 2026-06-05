import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { shipmentApi, type CreateShipmentPayload, type PackageType, type ShipmentType, type TimeWindow, type DeliveryMethod } from "../api/shipments";
import { branchApi } from "../api/branches";
import { useAuth } from "../context/AuthContext";

const TEMPLATE_HEADERS = [
  "sender_name", "sender_dni", "sender_phone", "sender_email",
  "sender_street", "sender_city", "sender_province", "sender_postal_code",
  "recipient_name", "recipient_dni", "recipient_phone", "recipient_email",
  "recipient_street", "recipient_city", "recipient_province", "recipient_postal_code",
  "weight_kg", "package_type", "shipment_type", "time_window", "delivery_method",
  "is_fragile", "special_instructions", "receiving_branch_id",
  "recipient_latitude", "recipient_longitude",
];

const REQUIRED_HEADERS = [
  "sender_name", "sender_dni", "sender_phone",
  "sender_street", "sender_city", "sender_province", "sender_postal_code",
  "recipient_name", "recipient_dni", "recipient_phone",
  "recipient_street", "recipient_city", "recipient_province", "recipient_postal_code",
  "weight_kg", "package_type",
];

type RowStatus = "valid" | "invalid";

interface ParsedRow {
  rowNumber: number;
  status: RowStatus;
  errors: string[];
  payload?: CreateShipmentPayload;
  raw: Record<string, string>;
}

type Stage = "idle" | "preview" | "uploading" | "done";

interface UploadResult {
  rowNumber: number;
  trackingId?: string;
  error?: string;
}

function parseBool(val: string): boolean {
  const v = val.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function parseLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } | { parseError: string } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) {
    return { parseError: "El archivo debe contener una fila de encabezados y al menos una fila de datos." };
  }

  const headers = parseLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/[" ]/g, ""));

  if (headers.length < 5) {
    return {
      parseError:
        "Formato CSV inválido. Asegurate de que el archivo use comas como separadores de columna y que coincida con la plantilla provista.",
    };
  }

  const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missingHeaders.length > 0) {
    return {
      parseError: `Faltan columnas obligatorias: ${missingHeaders.join(", ")}. Usá la plantilla provista.`,
    };
  }

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] ?? "").trim();
    });
    rows.push(row);
  }

  return { headers, rows };
}

function validateRow(
  raw: Record<string, string>,
  branchLocked: boolean,
  branchId: string,
): { errors: string[]; payload?: CreateShipmentPayload } {
  const errors: string[] = [];

  // Sender
  if (!raw.sender_name) errors.push("sender_name es obligatorio");
  if (!raw.sender_dni) {
    errors.push("sender_dni es obligatorio");
  } else if (!/^\d+$/.test(raw.sender_dni)) {
    errors.push("sender_dni debe contener solo dígitos");
  } else if (raw.sender_dni.length < 7) {
    errors.push("sender_dni debe tener al menos 7 dígitos");
  }
  if (!raw.sender_phone) errors.push("sender_phone es obligatorio");
  if (raw.sender_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.sender_email)) {
    errors.push("sender_email tiene un formato inválido");
  }
  if (!raw.sender_street) errors.push("sender_street es obligatorio");
  if (!raw.sender_city) {
    errors.push("sender_city es obligatorio");
  } else if (/^\d+$/.test(raw.sender_city)) {
    errors.push("sender_city no puede contener solo números");
  }
  if (!raw.sender_province) errors.push("sender_province es obligatorio");
  if (!raw.sender_postal_code) {
    errors.push("sender_postal_code es obligatorio");
  } else if (/^[a-zA-Z]+$/.test(raw.sender_postal_code)) {
    errors.push("sender_postal_code debe contener al menos un dígito");
  }

  // Recipient
  if (!raw.recipient_name) errors.push("recipient_name es obligatorio");
  if (!raw.recipient_dni) {
    errors.push("recipient_dni es obligatorio");
  } else if (!/^\d+$/.test(raw.recipient_dni)) {
    errors.push("recipient_dni debe contener solo dígitos");
  } else if (raw.recipient_dni.length < 7) {
    errors.push("recipient_dni debe tener al menos 7 dígitos");
  }
  if (!raw.recipient_phone) errors.push("recipient_phone es obligatorio");
  if (raw.recipient_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.recipient_email)) {
    errors.push("recipient_email tiene un formato inválido");
  }
  if (!raw.recipient_street) errors.push("recipient_street es obligatorio");
  if (!raw.recipient_city) {
    errors.push("recipient_city es obligatorio");
  } else if (/^\d+$/.test(raw.recipient_city)) {
    errors.push("recipient_city no puede contener solo números");
  }
  if (!raw.recipient_province) errors.push("recipient_province es obligatorio");
  if (!raw.recipient_postal_code) {
    errors.push("recipient_postal_code es obligatorio");
  } else if (/^[a-zA-Z]+$/.test(raw.recipient_postal_code)) {
    errors.push("recipient_postal_code debe contener al menos un dígito");
  }

  // Weight
  const weightKg = parseFloat(raw.weight_kg ?? "");
  if (!raw.weight_kg) {
    errors.push("weight_kg es obligatorio");
  } else if (isNaN(weightKg) || weightKg <= 0) {
    errors.push("weight_kg debe ser un número positivo");
  }

  // Package type
  const validPackageTypes = ["envelope", "box"];
  if (!raw.package_type) {
    errors.push("package_type es obligatorio (envelope, box)");
  } else if (!validPackageTypes.includes(raw.package_type)) {
    errors.push(`package_type debe ser uno de: ${validPackageTypes.join(", ")}`);
  }

  // Optional enums
  if (raw.shipment_type && !["normal", "express"].includes(raw.shipment_type)) {
    errors.push("shipment_type debe ser normal o express");
  }
  if (raw.time_window && !["morning", "afternoon", "flexible"].includes(raw.time_window)) {
    errors.push("time_window debe ser morning, afternoon o flexible");
  }
  if (raw.delivery_method && !["ultima_milla", "retiro_sucursal"].includes(raw.delivery_method)) {
    errors.push("delivery_method debe ser ultima_milla o retiro_sucursal");
  }

  // Receiving branch
  const receivingBranchId = branchLocked ? branchId : (raw.receiving_branch_id ?? "");
  if (!branchLocked && !receivingBranchId) {
    errors.push("receiving_branch_id es obligatorio");
  }

  // Recipient coordinates (optional)
  let recipientLat: number | undefined;
  let recipientLng: number | undefined;
  if (raw.recipient_latitude) {
    const v = parseFloat(raw.recipient_latitude);
    if (isNaN(v) || v < -90 || v > 90) errors.push("recipient_latitude debe ser un número entre -90 y 90");
    else recipientLat = v;
  }
  if (raw.recipient_longitude) {
    const v = parseFloat(raw.recipient_longitude);
    if (isNaN(v) || v < -180 || v > 180) errors.push("recipient_longitude debe ser un número entre -180 y 180");
    else recipientLng = v;
  }
  if ((raw.recipient_latitude && !raw.recipient_longitude) || (!raw.recipient_latitude && raw.recipient_longitude)) {
    errors.push("recipient_latitude y recipient_longitude deben completarse juntos");
  }

  if (errors.length > 0) return { errors };

  const payload: CreateShipmentPayload = {
    sender: {
      name: raw.sender_name,
      dni: raw.sender_dni,
      phone: raw.sender_phone,
      email: raw.sender_email || undefined,
      address: {
        street: raw.sender_street,
        city: raw.sender_city,
        province: raw.sender_province,
        postal_code: raw.sender_postal_code,
      },
    },
    recipient: {
      name: raw.recipient_name,
      dni: raw.recipient_dni,
      phone: raw.recipient_phone,
      email: raw.recipient_email || undefined,
      address: {
        street: raw.recipient_street,
        city: raw.recipient_city,
        province: raw.recipient_province,
        postal_code: raw.recipient_postal_code,
        latitude: recipientLat,
        longitude: recipientLng,
      },
    },
    weight_kg: weightKg,
    package_type: raw.package_type as PackageType,
    shipment_type: (raw.shipment_type as ShipmentType) || "normal",
    time_window: (raw.time_window as TimeWindow) || "flexible",
    delivery_method: (raw.delivery_method as DeliveryMethod) || "ultima_milla",
    is_fragile: raw.is_fragile ? parseBool(raw.is_fragile) : false,
    special_instructions: raw.special_instructions || undefined,
    receiving_branch_id: receivingBranchId,
  };

  return { errors: [], payload };
}

export function BulkUpload() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const branchLocked = (user?.role === "operator" || user?.role === "supervisor") && !!user?.branch_id;
  const branchId = user?.branch_id ?? "";

  const [stage, setStage] = useState<Stage>("idle");
  const [parseError, setParseError] = useState<string>("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    branchApi.listActive().catch(() => {});
  }, []);

  const downloadTemplate = () => {
    const sampleRow = [
      "Juan Pérez", "12345678", "1134567890", "juan@example.com",
      "Av. Corrientes 1234", "Buenos Aires", "Buenos Aires", "C1043",
      "María García", "87654321", "1198765432", "",
      "Calle Falsa 123", "Córdoba", "Córdoba", "X5000",
      "2.5", "box", "normal", "flexible", "ultima_milla",
      "false", "", branchLocked ? branchId : "CDBA-01",
      "", "",
    ].map((v) => `"${v}"`).join(",");

    const csv = TEMPLATE_HEADERS.join(",") + "\n" + sampleRow;
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bulk_shipment_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const processFile = (file: File) => {
    setParseError("");
    setRows([]);

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setParseError("Tipo de archivo inválido. Por favor subí un archivo .csv.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const raw = (e.target?.result as string) ?? "";
      // Strip BOM if present
      const text = raw.startsWith("﻿") ? raw.slice(1) : raw;
      const result = parseCSV(text);

      if ("parseError" in result) {
        setParseError(result.parseError);
        return;
      }

      const parsed: ParsedRow[] = result.rows.map((row, idx) => {
        const { errors, payload } = validateRow(row, branchLocked, branchId);
        return {
          rowNumber: idx + 1,
          status: errors.length === 0 ? "valid" : "invalid",
          errors,
          payload,
          raw: row,
        };
      });

      setRows(parsed);
      setStage("preview");
    };
    reader.readAsText(file, "UTF-8");
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleUpload = async () => {
    const validRows = rows.filter((r) => r.status === "valid" && r.payload);
    setProgress({ current: 0, total: validRows.length });
    setStage("uploading");

    const results: UploadResult[] = [];
    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      try {
        const shipment = await shipmentApi.create(row.payload!);
        results.push({ rowNumber: row.rowNumber, trackingId: shipment.tracking_id });
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        results.push({ rowNumber: row.rowNumber, error: msg ?? "Error del servidor." });
      }
      setProgress({ current: i + 1, total: validRows.length });
    }

    setUploadResults(results);
    setStage("done");
  };

  const reset = () => {
    setStage("idle");
    setParseError("");
    setRows([]);
    setUploadResults([]);
    setProgress({ current: 0, total: 0 });
  };

  const validCount = rows.filter((r) => r.status === "valid").length;
  const invalidCount = rows.filter((r) => r.status === "invalid").length;

  return (
    <div className="p-6 md:px-8 max-w-[920px] mx-auto">
      <button
        onClick={() => navigate("/")}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        Volver al listado
      </button>

      {/* ── IDLE ── */}
      {stage === "idle" && (
        <>
          <div className="border border-gray-200 rounded-lg p-4 md:p-5 mb-6 bg-white flex items-center justify-between gap-4">
            <div>
              <div className="font-semibold text-sm mb-1">Paso 1 — Descargar plantilla</div>
              <div className="text-xs text-gray-500">
                Completá la plantilla CSV y volvé a subirla. No modifiques los encabezados de columna.
              </div>
            </div>
            <button
              onClick={downloadTemplate}
              className="bg-blue-700 hover:bg-blue-800 transition-colors text-white rounded-md px-4 py-2 cursor-pointer text-xs font-semibold whitespace-nowrap"
            >
              ↓ Descargar plantilla
            </button>
          </div>

          {parseError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-5 text-red-700 text-sm">
              <strong>Error:</strong> {parseError}
            </div>
          )}

          <div className="font-semibold text-sm mb-2.5">Paso 2 — Subir tu CSV</div>
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed ${
              isDragging ? "border-blue-500 bg-blue-100" : "border-blue-300 bg-blue-50"
            } rounded-xl py-12 md:py-14 px-6 text-center cursor-pointer transition-colors`}
          >
            <div className="text-4xl mb-3 leading-none">📂</div>
            <div className="font-semibold text-sm mb-1.5">Arrastrá y soltá tu CSV acá</div>
            <div className="text-gray-500 text-xs">o hacé clic para explorar — solo archivos .csv</div>
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileInput} className="hidden" />
          </div>
        </>
      )}

      {/* ── PREVIEW ── */}
      {stage === "preview" && (
        <>
          <div className="flex gap-3 mb-5 flex-wrap">
            <StatCard value={validCount} label="Listas para importar" className="bg-green-50 border border-green-200 text-green-700" />
            {invalidCount > 0 && (
              <StatCard value={invalidCount} label="Filas con errores (omitidas)" className="bg-red-50 border border-red-200 text-red-700" />
            )}
            <StatCard value={rows.length} label="Total de filas" className="bg-white border border-gray-200 text-gray-900" />
          </div>

          {validCount === 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-red-700 text-sm">
              No se encontraron filas válidas. Corregí los errores que se muestran abajo y volvé a subir el archivo.
            </div>
          )}

          <div className="border border-gray-200 rounded-lg overflow-auto mb-5">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-3.5 py-2.5 text-left font-semibold text-xs text-gray-500 whitespace-nowrap">Fila</th>
                  <th className="px-3.5 py-2.5 text-left font-semibold text-xs text-gray-500 whitespace-nowrap">Remitente</th>
                  <th className="px-3.5 py-2.5 text-left font-semibold text-xs text-gray-500 whitespace-nowrap">Destinatario</th>
                  <th className="px-3.5 py-2.5 text-left font-semibold text-xs text-gray-500 whitespace-nowrap">Peso</th>
                  <th className="px-3.5 py-2.5 text-left font-semibold text-xs text-gray-500 whitespace-nowrap">Paquete</th>
                  <th className="px-3.5 py-2.5 text-left font-semibold text-xs text-gray-500 whitespace-nowrap">Estado / Errores</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.rowNumber}
                    className={`${row.status === "valid" ? "bg-green-50" : "bg-red-50"} border-t border-gray-200`}
                  >
                    <td className="px-3.5 py-2.5 align-top">{row.rowNumber}</td>
                    <td className="px-3.5 py-2.5 align-top">{row.raw.sender_name || <em className="text-gray-400">—</em>}</td>
                    <td className="px-3.5 py-2.5 align-top">{row.raw.recipient_name || <em className="text-gray-400">—</em>}</td>
                    <td className="px-3.5 py-2.5 align-top">{row.raw.weight_kg ? `${row.raw.weight_kg} kg` : "—"}</td>
                    <td className="px-3.5 py-2.5 align-top">{row.raw.package_type || "—"}</td>
                    <td className="px-3.5 py-2.5 align-top">
                      {row.status === "valid" ? (
                        <span className="text-green-600 font-semibold">✓ Válida</span>
                      ) : (
                        <ul className="m-0 pl-4 text-red-600">
                          {row.errors.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3">
            <button onClick={reset} className="bg-gray-100 text-gray-700 border border-gray-200 rounded-md px-5 py-2 cursor-pointer text-sm hover:bg-gray-200 transition-colors">
              ← Subir otro archivo
            </button>
            {validCount > 0 && (
              <button onClick={handleUpload} className="bg-blue-700 hover:bg-blue-800 transition-colors text-white rounded-md px-5 py-2 cursor-pointer text-sm font-semibold">
                Importar {validCount} envío{validCount !== 1 ? "s" : ""}
              </button>
            )}
          </div>
        </>
      )}

      {/* ── UPLOADING ── */}
      {stage === "uploading" && (
        <div className="text-center py-16">
          <div className="text-sm font-semibold mb-5">
            Importando envíos…
          </div>
          <div className="bg-gray-100 rounded-full h-2.5 max-w-[440px] mx-auto mb-3.5 overflow-hidden">
            <div
              className="bg-blue-700 h-full transition-all duration-250"
              style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
            />
          </div>
          <div className="text-gray-500 text-xs">{progress.current} de {progress.total}</div>
        </div>
      )}

      {/* ── DONE ── */}
      {stage === "done" && (() => {
        const succeeded = uploadResults.filter((r) => r.trackingId);
        const apiErrors = uploadResults.filter((r) => r.error);
        const skipped = rows.filter((r) => r.status === "invalid");
        const hasFailures = apiErrors.length > 0 || skipped.length > 0;

        return (
          <>
            <h2 className="mt-0 mb-4">Importación completada</h2>

            <div className="flex gap-3 mb-7 flex-wrap">
              <StatCard value={succeeded.length} label="Envíos creados" className="bg-green-50 border border-green-200 text-green-700" />
              {apiErrors.length > 0 && (
                <StatCard value={apiErrors.length} label="Fallidos (error al importar)" className="bg-red-50 border border-red-200 text-red-700" />
              )}
              {skipped.length > 0 && (
                <StatCard value={skipped.length} label="Omitidos (validación)" className="bg-amber-50 border border-amber-200 text-amber-600" />
              )}
            </div>

            {succeeded.length > 0 && (
              <div className="mb-6">
                <div className="font-semibold text-sm mb-2">Envíos creados</div>
                <div className="border border-gray-200 rounded-lg overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="px-3.5 py-2.5 text-left font-semibold text-xs text-gray-500 whitespace-nowrap">Fila</th>
                        <th className="px-3.5 py-2.5 text-left font-semibold text-xs text-gray-500 whitespace-nowrap">ID de seguimiento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {succeeded.map((r) => (
                        <tr key={r.rowNumber} className="border-t border-gray-200">
                          <td className="px-3.5 py-2.5 align-top">{r.rowNumber}</td>
                          <td className="px-3.5 py-2.5 align-top">
                            <button
                              onClick={() => navigate(`/shipments/${r.trackingId}`)}
                              className="bg-transparent border-none text-blue-600 cursor-pointer p-0 text-xs underline hover:text-blue-700 transition-colors"
                            >
                              {r.trackingId}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {hasFailures && (
              <div className="mb-6">
                <div className="font-semibold text-sm mb-2 text-red-700">Filas no importadas</div>
                <div className="border border-red-200 rounded-lg overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-red-50">
                        <th className="px-3.5 py-2.5 text-left font-semibold text-xs text-gray-500 whitespace-nowrap">Fila</th>
                        <th className="px-3.5 py-2.5 text-left font-semibold text-xs text-gray-500 whitespace-nowrap">Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {apiErrors.map((r) => (
                        <tr key={`api-${r.rowNumber}`} className="border-t border-red-200">
                          <td className="px-3.5 py-2.5 align-top">{r.rowNumber}</td>
                          <td className="px-3.5 py-2.5 align-top text-red-700">Error al importar: {r.error}</td>
                        </tr>
                      ))}
                      {skipped.map((r) => (
                        <tr key={`skip-${r.rowNumber}`} className="border-t border-red-200">
                          <td className="px-3.5 py-2.5 align-top">{r.rowNumber}</td>
                          <td className="px-3.5 py-2.5 align-top text-amber-600">Validación: {r.errors.join("; ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={reset} className="bg-gray-100 text-gray-700 border border-gray-200 rounded-md px-5 py-2 cursor-pointer text-sm hover:bg-gray-200 transition-colors">
                Importar otro archivo
              </button>
              <button onClick={() => navigate("/")} className="bg-blue-700 hover:bg-blue-800 transition-colors text-white rounded-md px-5 py-2 cursor-pointer text-sm font-semibold">
                Ver envíos
              </button>
            </div>
          </>
        );
      })()}
    </div>
  );
}

function StatCard({ value, label, className }: { value: number; label: string; className?: string }) {
  return (
    <div className={`flex-[1_1_140px] rounded-lg px-4 py-3.5 ${className ?? ""}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs opacity-80">{label}</div>
    </div>
  );
}
