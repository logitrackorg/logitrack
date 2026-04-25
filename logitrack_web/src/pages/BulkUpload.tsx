import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { shipmentApi, type CreateShipmentPayload, type PackageType, type ShipmentType, type TimeWindow } from "../api/shipments";
import { branchApi } from "../api/branches";
import { useAuth } from "../context/AuthContext";

const TEMPLATE_HEADERS = [
  "sender_name", "sender_dni", "sender_phone", "sender_email",
  "sender_street", "sender_city", "sender_province", "sender_postal_code",
  "recipient_name", "recipient_dni", "recipient_phone", "recipient_email",
  "recipient_street", "recipient_city", "recipient_province", "recipient_postal_code",
  "weight_kg", "package_type", "shipment_type", "time_window",
  "is_fragile", "cold_chain", "special_instructions", "receiving_branch_id",
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
    return { parseError: "The file must contain a header row and at least one data row." };
  }

  const headers = parseLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/[" ]/g, ""));

  if (headers.length < 5) {
    return {
      parseError:
        "Invalid CSV format. Make sure the file uses commas as column separators and matches the provided template.",
    };
  }

  const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missingHeaders.length > 0) {
    return {
      parseError: `Missing required columns: ${missingHeaders.join(", ")}. Please use the provided template.`,
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
  if (!raw.sender_name) errors.push("sender_name is required");
  if (!raw.sender_dni) {
    errors.push("sender_dni is required");
  } else if (!/^\d+$/.test(raw.sender_dni)) {
    errors.push("sender_dni must contain digits only");
  } else if (raw.sender_dni.length < 7) {
    errors.push("sender_dni must be at least 7 digits");
  }
  if (!raw.sender_phone) errors.push("sender_phone is required");
  if (raw.sender_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.sender_email)) {
    errors.push("sender_email format is invalid");
  }
  if (!raw.sender_street) errors.push("sender_street is required");
  if (!raw.sender_city) {
    errors.push("sender_city is required");
  } else if (/^\d+$/.test(raw.sender_city)) {
    errors.push("sender_city cannot be numbers only");
  }
  if (!raw.sender_province) errors.push("sender_province is required");
  if (!raw.sender_postal_code) {
    errors.push("sender_postal_code is required");
  } else if (/^[a-zA-Z]+$/.test(raw.sender_postal_code)) {
    errors.push("sender_postal_code must contain at least one digit");
  }

  // Recipient
  if (!raw.recipient_name) errors.push("recipient_name is required");
  if (!raw.recipient_dni) {
    errors.push("recipient_dni is required");
  } else if (!/^\d+$/.test(raw.recipient_dni)) {
    errors.push("recipient_dni must contain digits only");
  } else if (raw.recipient_dni.length < 7) {
    errors.push("recipient_dni must be at least 7 digits");
  }
  if (!raw.recipient_phone) errors.push("recipient_phone is required");
  if (raw.recipient_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.recipient_email)) {
    errors.push("recipient_email format is invalid");
  }
  if (!raw.recipient_street) errors.push("recipient_street is required");
  if (!raw.recipient_city) {
    errors.push("recipient_city is required");
  } else if (/^\d+$/.test(raw.recipient_city)) {
    errors.push("recipient_city cannot be numbers only");
  }
  if (!raw.recipient_province) errors.push("recipient_province is required");
  if (!raw.recipient_postal_code) {
    errors.push("recipient_postal_code is required");
  } else if (/^[a-zA-Z]+$/.test(raw.recipient_postal_code)) {
    errors.push("recipient_postal_code must contain at least one digit");
  }

  // Weight
  const weightKg = parseFloat(raw.weight_kg ?? "");
  if (!raw.weight_kg) {
    errors.push("weight_kg is required");
  } else if (isNaN(weightKg) || weightKg <= 0) {
    errors.push("weight_kg must be a positive number");
  }

  // Package type
  const validPackageTypes = ["envelope", "box", "pallet"];
  if (!raw.package_type) {
    errors.push("package_type is required (envelope, box, pallet)");
  } else if (!validPackageTypes.includes(raw.package_type)) {
    errors.push(`package_type must be one of: ${validPackageTypes.join(", ")}`);
  }

  // Optional enums
  if (raw.shipment_type && !["normal", "express"].includes(raw.shipment_type)) {
    errors.push("shipment_type must be normal or express");
  }
  if (raw.time_window && !["morning", "afternoon", "flexible"].includes(raw.time_window)) {
    errors.push("time_window must be morning, afternoon, or flexible");
  }

  // Receiving branch
  const receivingBranchId = branchLocked ? branchId : (raw.receiving_branch_id ?? "");
  if (!branchLocked && !receivingBranchId) {
    errors.push("receiving_branch_id is required");
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
      },
    },
    weight_kg: weightKg,
    package_type: raw.package_type as PackageType,
    shipment_type: (raw.shipment_type as ShipmentType) || "normal",
    time_window: (raw.time_window as TimeWindow) || "flexible",
    is_fragile: raw.is_fragile ? parseBool(raw.is_fragile) : false,
    cold_chain: raw.cold_chain ? parseBool(raw.cold_chain) : false,
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
      "2.5", "box", "normal", "flexible",
      "false", "false", "", branchLocked ? branchId : "CDBA-01",
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
      setParseError("Invalid file type. Please upload a .csv file.");
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
        results.push({ rowNumber: row.rowNumber, error: msg ?? "Server error" });
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
    <div style={{ padding: "24px 32px", maxWidth: 920, margin: "0 auto" }}>
      <button
        onClick={() => navigate("/")}
        style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", padding: 0, fontSize: 14, marginBottom: 16 }}
      >
        ← Back to list
      </button>

      <h1 style={{ marginTop: 0, marginBottom: 6 }}>Bulk Import Shipments</h1>
      <p style={{ color: "#64748b", marginBottom: 28, fontSize: 14, marginTop: 0 }}>
        Upload a CSV file to create multiple shipments at once. Valid rows are imported and invalid rows are skipped with a detailed error report.
      </p>

      {/* ── IDLE ── */}
      {stage === "idle" && (
        <>
          <div style={{
            border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 20px",
            marginBottom: 24, background: "#f8fafc",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
          }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Step 1 — Download template</div>
              <div style={{ fontSize: 13, color: "#64748b" }}>
                Fill in the CSV template and re-upload it. Do not change the column headers.
                {branchLocked && (
                  <span style={{ color: "#0369a1" }}> The <code>receiving_branch_id</code> column will be ignored — your branch is applied automatically.</span>
                )}
              </div>
            </div>
            <button
              onClick={downloadTemplate}
              style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 7, padding: "9px 18px", cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}
            >
              ↓ Download template
            </button>
          </div>

          {parseError && (
            <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "12px 16px", marginBottom: 20, color: "#dc2626", fontSize: 14 }}>
              <strong>Error:</strong> {parseError}
            </div>
          )}

          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Step 2 — Upload your CSV</div>
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${isDragging ? "#3b82f6" : "#cbd5e1"}`,
              borderRadius: 12,
              padding: "52px 24px",
              textAlign: "center",
              cursor: "pointer",
              background: isDragging ? "#eff6ff" : "#fafafa",
              transition: "border-color 0.15s, background 0.15s",
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 12, lineHeight: 1 }}>📂</div>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Drag & drop your CSV here</div>
            <div style={{ color: "#64748b", fontSize: 13 }}>or click to browse — .csv files only</div>
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileInput} style={{ display: "none" }} />
          </div>
        </>
      )}

      {/* ── PREVIEW ── */}
      {stage === "preview" && (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
            <StatCard value={validCount} label="Ready to import" color="#16a34a" bg="#f0fdf4" border="#86efac" />
            {invalidCount > 0 && (
              <StatCard value={invalidCount} label="Rows with errors (skipped)" color="#dc2626" bg="#fef2f2" border="#fca5a5" />
            )}
            <StatCard value={rows.length} label="Total rows" color="#1e293b" bg="#f8fafc" border="#e2e8f0" />
          </div>

          {validCount === 0 && (
            <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "12px 16px", marginBottom: 16, color: "#dc2626", fontSize: 14 }}>
              No valid rows found. Fix the errors below and upload the file again.
            </div>
          )}

          <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "auto", marginBottom: 20 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f1f5f9" }}>
                  <th style={TH}>Row</th>
                  <th style={TH}>Sender</th>
                  <th style={TH}>Recipient</th>
                  <th style={TH}>Weight</th>
                  <th style={TH}>Package</th>
                  <th style={TH}>Status / Errors</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.rowNumber}
                    style={{ background: row.status === "valid" ? "#f0fdf4" : "#fff5f5", borderTop: "1px solid #e2e8f0" }}
                  >
                    <td style={TD}>{row.rowNumber}</td>
                    <td style={TD}>{row.raw.sender_name || <em style={{ color: "#94a3b8" }}>—</em>}</td>
                    <td style={TD}>{row.raw.recipient_name || <em style={{ color: "#94a3b8" }}>—</em>}</td>
                    <td style={TD}>{row.raw.weight_kg ? `${row.raw.weight_kg} kg` : "—"}</td>
                    <td style={TD}>{row.raw.package_type || "—"}</td>
                    <td style={TD}>
                      {row.status === "valid" ? (
                        <span style={{ color: "#16a34a", fontWeight: 600 }}>✓ Valid</span>
                      ) : (
                        <ul style={{ margin: 0, paddingLeft: 18, color: "#dc2626" }}>
                          {row.errors.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={reset} style={secondaryBtn}>← Upload another file</button>
            {validCount > 0 && (
              <button onClick={handleUpload} style={primaryBtn}>
                Import {validCount} shipment{validCount !== 1 ? "s" : ""}
              </button>
            )}
          </div>
        </>
      )}

      {/* ── UPLOADING ── */}
      {stage === "uploading" && (
        <div style={{ textAlign: "center", padding: "64px 0" }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 20 }}>
            Importing shipments…
          </div>
          <div style={{ background: "#e2e8f0", borderRadius: 999, height: 10, maxWidth: 440, margin: "0 auto 14px", overflow: "hidden" }}>
            <div style={{
              background: "#1e3a5f", height: "100%",
              width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
              transition: "width 0.25s",
            }} />
          </div>
          <div style={{ color: "#64748b", fontSize: 13 }}>{progress.current} of {progress.total}</div>
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
            <h2 style={{ marginTop: 0, marginBottom: 16 }}>Import complete</h2>

            <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap" }}>
              <StatCard value={succeeded.length} label="Shipments created" color="#16a34a" bg="#f0fdf4" border="#86efac" />
              {apiErrors.length > 0 && (
                <StatCard value={apiErrors.length} label="Failed (API error)" color="#dc2626" bg="#fef2f2" border="#fca5a5" />
              )}
              {skipped.length > 0 && (
                <StatCard value={skipped.length} label="Skipped (validation)" color="#d97706" bg="#fffbeb" border="#fde68a" />
              )}
            </div>

            {succeeded.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Created shipments</div>
                <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#f1f5f9" }}>
                        <th style={TH}>Row</th>
                        <th style={TH}>Tracking ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {succeeded.map((r) => (
                        <tr key={r.rowNumber} style={{ borderTop: "1px solid #e2e8f0" }}>
                          <td style={TD}>{r.rowNumber}</td>
                          <td style={TD}>
                            <button
                              onClick={() => navigate(`/shipments/${r.trackingId}`)}
                              style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", padding: 0, fontSize: 13, textDecoration: "underline" }}
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
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, color: "#b91c1c" }}>Rows not imported</div>
                <div style={{ border: "1px solid #fca5a5", borderRadius: 8, overflow: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#fff5f5" }}>
                        <th style={TH}>Row</th>
                        <th style={TH}>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {apiErrors.map((r) => (
                        <tr key={`api-${r.rowNumber}`} style={{ borderTop: "1px solid #fca5a5" }}>
                          <td style={TD}>{r.rowNumber}</td>
                          <td style={{ ...TD, color: "#dc2626" }}>API error: {r.error}</td>
                        </tr>
                      ))}
                      {skipped.map((r) => (
                        <tr key={`skip-${r.rowNumber}`} style={{ borderTop: "1px solid #fca5a5" }}>
                          <td style={TD}>{r.rowNumber}</td>
                          <td style={{ ...TD, color: "#b45309" }}>Validation: {r.errors.join("; ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={reset} style={secondaryBtn}>Import another file</button>
              <button onClick={() => navigate("/")} style={primaryBtn}>View shipments</button>
            </div>
          </>
        );
      })()}
    </div>
  );
}

function StatCard({ value, label, color, bg, border }: { value: number; label: string; color: string; bg: string; border: string }) {
  return (
    <div style={{ flex: "1 1 140px", background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: "14px 18px" }}>
      <div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 13, color, opacity: 0.8 }}>{label}</div>
    </div>
  );
}

const TH: React.CSSProperties = {
  padding: "10px 14px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "#475569", whiteSpace: "nowrap",
};
const TD: React.CSSProperties = {
  padding: "10px 14px", verticalAlign: "top",
};
const primaryBtn: React.CSSProperties = {
  background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 7,
  padding: "9px 20px", cursor: "pointer", fontSize: 14, fontWeight: 600,
};
const secondaryBtn: React.CSSProperties = {
  background: "#f1f5f9", color: "#334155", border: "1px solid #cbd5e1",
  borderRadius: 7, padding: "9px 20px", cursor: "pointer", fontSize: 14,
};
