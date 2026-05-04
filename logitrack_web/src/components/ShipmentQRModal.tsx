import React, { useRef } from 'react';
import './ShipmentQRModal.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  trackingId: string;
  qrCodeBase64: string;
  trackingUrl: string;
}

const ShipmentQRModal: React.FC<Props> = ({
  isOpen,
  onClose,
  trackingId,
  qrCodeBase64,
  trackingUrl,
}) => {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const doc = printWindow.document;
    doc.title = 'QR - ' + trackingId.replace(/[<>"'&]/g, '');

    const style = doc.createElement('style');
    style.textContent = `
      body {
        font-family: Arial, sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        margin: 0;
        padding: 20px;
      }
      .qr-print-container { text-align: center; }
      .qr-image { width: 256px; height: 256px; border: 1px solid #eee; padding: 8px; }
      .tracking-number {
        font-size: 24px;
        font-weight: bold;
        font-family: 'Courier New', monospace;
        letter-spacing: 2px;
        margin-top: 16px;
      }
      .tracking-url { font-size: 11px; color: #666; margin-top: 8px; word-break: break-all; }
    `;
    doc.head.appendChild(style);

    const container = doc.createElement('div');
    container.className = 'qr-print-container';
    container.appendChild(printRef.current!.cloneNode(true));
    doc.body.appendChild(container);

    printWindow.onload = () => {
      printWindow.print();
      printWindow.onafterprint = () => printWindow.close();
    };
    printWindow.focus();
    printWindow.print();
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = `data:image/png;base64,${qrCodeBase64}`;
    link.download = `QR_${trackingId}.png`;
    link.click();
  };

  if (!isOpen) return null;

  return (
    <div className="qr-modal-overlay" onClick={onClose}>
      <div className="qr-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="qr-modal-header">
          <h2>📦 Código QR del Envío</h2>
          <button className="qr-modal-close" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>

        {/* CA-4: QR con tracking ID en texto legible */}
        <div ref={printRef} className="qr-printable-area">
          <div className="qr-code-container">
            <img
              src={`data:image/png;base64,${qrCodeBase64}`}
              alt={`QR Code ${trackingId}`}
              className="qr-image"
            />
            <div className="qr-tracking-text">
              <strong>Tracking ID:</strong>
              <div className="tracking-number">{trackingId}</div>
            </div>
            <div className="qr-url-text">
              <small>{trackingUrl}</small>
            </div>
          </div>
        </div>

        <div className="qr-modal-actions">
          <button className="btn-primary" onClick={handlePrint}>
            🖨️ Imprimir
          </button>
          <button className="btn-secondary" onClick={handleDownload}>
            💾 Descargar PNG
          </button>
          <button className="btn-outline" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShipmentQRModal;