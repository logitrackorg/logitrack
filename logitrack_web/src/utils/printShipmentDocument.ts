import type { Shipment } from '../api/shipments';
import type { Branch } from '../api/branches';
import type { OrganizationConfig } from '../api/organizationApi';

const PACKAGE_LABELS: Record<string, string> = {
  envelope: 'Sobre',
  box: 'Caja',
  pallet: 'Pallet',
};

const SHIPMENT_TYPE_LABELS: Record<string, string> = {
  normal: 'Normal',
  express: 'Express',
};

const TIME_WINDOW_LABELS: Record<string, string> = {
  morning: 'Mañana (8–12 hs)',
  afternoon: 'Tarde (12–18 hs)',
  flexible: 'Flexible',
};

function fmtDateES(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function fmtDateTimeES(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function printShipmentDocument(
  shipment: Shipment,
  branches: Branch[],
  qrBase64: string,
  trackingUrl: string,
  org?: OrganizationConfig | null,
): void {
  const cor = shipment.corrections ?? {};

  // Resolve corrected values (CA-4)
  const senderName = cor.sender_name ?? shipment.sender.name;
  const senderPhone = cor.sender_phone ?? shipment.sender.phone ?? '';
  const senderDni = cor.sender_dni ?? shipment.sender.dni ?? '';
  const senderEmail = cor.sender_email ?? shipment.sender.email ?? '';
  const originStreet = cor.origin_street ?? shipment.sender.address?.street ?? '';
  const originCity = cor.origin_city ?? shipment.sender.address?.city ?? '';
  const originProvince = cor.origin_province ?? shipment.sender.address?.province ?? '';
  const originPostal = cor.origin_postal_code ?? shipment.sender.address?.postal_code ?? '';
  const originAddr = [originStreet, originCity, originProvince, originPostal].filter(Boolean).join(', ');

  const recipientName = cor.recipient_name ?? shipment.recipient.name;
  const recipientPhone = cor.recipient_phone ?? shipment.recipient.phone ?? '';
  const recipientDni = cor.recipient_dni ?? shipment.recipient.dni ?? '';
  const recipientEmail = cor.recipient_email ?? shipment.recipient.email ?? '';
  const destStreet = cor.destination_street ?? shipment.recipient.address?.street ?? '';
  const destCity = cor.destination_city ?? shipment.recipient.address?.city ?? '';
  const destProvince = cor.destination_province ?? shipment.recipient.address?.province ?? '';
  const destPostal = cor.destination_postal_code ?? shipment.recipient.address?.postal_code ?? '';
  const destAddr = [destStreet, destCity, destProvince, destPostal].filter(Boolean).join(', ');

  const weightKg = cor.weight_kg ?? `${shipment.weight_kg}`;
  const packageType = PACKAGE_LABELS[cor.package_type ?? shipment.package_type] ?? shipment.package_type;
  const shipmentType = SHIPMENT_TYPE_LABELS[cor.shipment_type ?? shipment.shipment_type ?? 'normal'] ?? 'Normal';
  const timeWindow = TIME_WINDOW_LABELS[cor.time_window ?? shipment.time_window ?? 'flexible'] ?? 'Flexible';
  const specialInstructions = cor.special_instructions ?? shipment.special_instructions ?? '';

  const receivingBranch = branches.find(b => b.id === shipment.receiving_branch_id);
  const receivingBranchName = receivingBranch
    ? `${receivingBranch.name} — ${receivingBranch.address.city}, ${receivingBranch.address.province}`
    : shipment.receiving_branch_id ?? '—';

  const characteristics: string[] = [];
  if (shipment.is_fragile) characteristics.push('Frágil');
  if (shipment.cold_chain) characteristics.push('Cadena de frío');
  if (characteristics.length === 0) characteristics.push('Sin características especiales');

  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const now = fmtDateTimeES(new Date().toISOString());
  const createdAt = fmtDateES(shipment.created_at);

  const orgName = org?.name || 'La organización responsable del servicio';
  const orgSubLines = [org?.cuit ? `CUIT: ${org.cuit}` : '', org?.address || '', org?.phone || ''].filter(Boolean);

  printWindow.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Alta de Envío — ${shipment.tracking_id}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: Arial, sans-serif;
      font-size: 13px;
      color: #111;
      margin: 0;
      padding: 24px 32px;
      background: #fff;
    }
    .doc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #1e3a5f;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .doc-header-left { display: flex; flex-direction: column; gap: 2px; }
    .brand { font-size: 22px; font-weight: 700; color: #1e3a5f; letter-spacing: 1px; }
    .brand-sub { font-size: 11px; color: #6b7280; }
    .doc-title { font-size: 18px; font-weight: 700; color: #1e3a5f; text-align: right; }
    .tracking-id { font-family: 'Courier New', monospace; font-size: 20px; font-weight: 700; color: #1e3a5f; text-align: right; letter-spacing: 2px; }
    .doc-meta { font-size: 11px; color: #6b7280; text-align: right; }

    .section-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 14px;
    }
    .card {
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 10px 14px;
    }
    .card-title {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #6b7280;
      margin: 0 0 8px;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 4px;
    }
    .row { display: flex; gap: 4px; margin-bottom: 4px; font-size: 12px; }
    .row-label { color: #6b7280; min-width: 72px; flex-shrink: 0; }
    .row-value { font-weight: 600; }

    .pkg-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 14px;
    }
    .pkg-item { display: flex; flex-direction: column; gap: 2px; }
    .pkg-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; }
    .pkg-value { font-size: 13px; font-weight: 700; }

    .qr-row {
      display: flex;
      gap: 24px;
      align-items: center;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 12px 16px;
      margin-bottom: 14px;
    }
    .qr-img { width: 128px; height: 128px; flex-shrink: 0; }
    .qr-info { flex: 1; }
    .qr-tracking { font-family: 'Courier New', monospace; font-size: 18px; font-weight: 700; color: #1e3a5f; letter-spacing: 2px; margin-bottom: 4px; }
    .qr-url { font-size: 10px; color: #6b7280; word-break: break-all; }
    .qr-hint { font-size: 11px; color: #374151; margin-top: 8px; }

    .sig-section {
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 14px 16px;
      margin-bottom: 10px;
    }
    .sig-title { font-size: 12px; font-weight: 700; color: #374151; margin: 0 0 6px; }
    .sig-consent { font-size: 11px; color: #374151; margin: 0 0 12px; line-height: 1.5; }
    .sig-grid { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 24px; }
    .sig-field { display: flex; flex-direction: column; gap: 6px; }
    .sig-label { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
    .sig-line { border-bottom: 1px solid #374151; height: 36px; }
    .disclaimer {
      font-size: 10px;
      color: #6b7280;
      border-top: 1px solid #e5e7eb;
      padding-top: 8px;
      margin-bottom: 10px;
      line-height: 1.5;
    }

    .footer {
      border-top: 1px solid #e5e7eb;
      padding-top: 8px;
      font-size: 10px;
      color: #9ca3af;
      display: flex;
      justify-content: space-between;
    }

    .instructions-card {
      border: 1px solid #fcd34d;
      background: #fffbeb;
      border-radius: 6px;
      padding: 8px 14px;
      margin-bottom: 14px;
      font-size: 12px;
    }
    .instructions-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #92400e; margin-bottom: 4px; }

    @media print {
      body { padding: 10mm 14mm; }
      @page { size: A4; margin: 0; }
    }
  </style>
</head>
<body>
  <div class="doc-header">
    <div class="doc-header-left">
      <span class="brand">${orgName}</span>
      ${orgSubLines.map(l => `<span class="brand-sub">${l}</span>`).join('')}
    </div>
    <div>
      <div class="doc-title">COMPROBANTE DE ENVÍO</div>
      <div class="tracking-id">${shipment.tracking_id}</div>
      <div class="doc-meta">Fecha de alta: ${createdAt} &nbsp;|&nbsp; Generado: ${now}</div>
    </div>
  </div>

  <div class="section-grid">
    <div class="card">
      <p class="card-title">Remitente</p>
      <div class="row"><span class="row-label">Nombre:</span><span class="row-value">${senderName}</span></div>
      ${senderDni ? `<div class="row"><span class="row-label">DNI:</span><span class="row-value">${senderDni}</span></div>` : ''}
      <div class="row"><span class="row-label">Teléfono:</span><span class="row-value">${senderPhone || '—'}</span></div>
      ${senderEmail ? `<div class="row"><span class="row-label">Email:</span><span class="row-value">${senderEmail}</span></div>` : ''}
      <div class="row"><span class="row-label">Dirección:</span><span class="row-value">${originAddr || '—'}</span></div>
    </div>
    <div class="card">
      <p class="card-title">Destinatario</p>
      <div class="row"><span class="row-label">Nombre:</span><span class="row-value">${recipientName}</span></div>
      ${recipientDni ? `<div class="row"><span class="row-label">DNI:</span><span class="row-value">${recipientDni}</span></div>` : ''}
      <div class="row"><span class="row-label">Teléfono:</span><span class="row-value">${recipientPhone || '—'}</span></div>
      ${recipientEmail ? `<div class="row"><span class="row-label">Email:</span><span class="row-value">${recipientEmail}</span></div>` : ''}
      <div class="row"><span class="row-label">Dirección:</span><span class="row-value">${destAddr || '—'}</span></div>
      <div class="row"><span class="row-label">Sucursal:</span><span class="row-value">${receivingBranchName}</span></div>
    </div>
  </div>

  <div class="pkg-grid">
    <div class="pkg-item">
      <span class="pkg-label">Tipo de envío</span>
      <span class="pkg-value">${shipmentType}</span>
    </div>
    <div class="pkg-item">
      <span class="pkg-label">Tipo de bulto</span>
      <span class="pkg-value">${packageType}</span>
    </div>
    <div class="pkg-item">
      <span class="pkg-label">Peso</span>
      <span class="pkg-value">${weightKg} kg</span>
    </div>
    <div class="pkg-item">
      <span class="pkg-label">Ventana horaria</span>
      <span class="pkg-value">${timeWindow}</span>
    </div>
    <div class="pkg-item" style="grid-column: span 4;">
      <span class="pkg-label">Características</span>
      <span class="pkg-value">${characteristics.join(' · ')}</span>
    </div>
  </div>

  ${specialInstructions ? `
  <div class="instructions-card">
    <div class="instructions-label">Instrucciones especiales</div>
    <div>${specialInstructions}</div>
  </div>` : ''}

  <div class="qr-row">
    <img class="qr-img" src="data:image/png;base64,${qrBase64}" alt="QR ${shipment.tracking_id}" />
    <div class="qr-info">
      <div class="qr-tracking">${shipment.tracking_id}</div>
      <div class="qr-url">${trackingUrl}</div>
      <div class="qr-hint">Escanear para seguimiento en tiempo real del envío.</div>
    </div>
  </div>

  <div class="sig-section">
    <p class="sig-title">Consentimiento y declaración del remitente</p>
    <p class="sig-consent">
      El remitente declara que el contenido y los datos consignados en este comprobante son correctos y verídicos,
      y presta conformidad para el transporte del presente envío bajo los términos del servicio contratado con ${orgName}.
      Los datos personales del destinatario son utilizados exclusivamente para la gestión logística de este envío,
      conforme a la Ley N.° 25.326 de Protección de los Datos Personales.
    </p>
    <div class="sig-grid">
      <div class="sig-field">
        <div class="sig-line"></div>
        <span class="sig-label">Firma del remitente</span>
      </div>
      <div class="sig-field">
        <div class="sig-line"></div>
        <span class="sig-label">Aclaración</span>
      </div>
      <div class="sig-field">
        <div class="sig-line"></div>
        <span class="sig-label">Fecha y lugar</span>
      </div>
    </div>
  </div>

  <div class="disclaimer">
    ${orgName} actúa como responsable del tratamiento de los datos personales declarados en este formulario con la finalidad
    exclusiva de ejecutar el servicio de transporte contratado. El titular de los datos puede ejercer los derechos de acceso,
    rectificación y supresión previstos en la Ley N.° 25.326 de Protección de los Datos Personales ante ${orgName}.
    La DIRECCIÓN NACIONAL DE PROTECCIÓN DE DATOS PERSONALES es el organismo de control competente.
  </div>

  <div class="footer">
    <span>${orgName}</span>
    <span>Documento generado el ${now}</span>
  </div>

  <script>
    window.onload = function () {
      window.print();
      window.onafterprint = function () { window.close(); };
    };
  </script>
</body>
</html>`);

  printWindow.document.close();
}
