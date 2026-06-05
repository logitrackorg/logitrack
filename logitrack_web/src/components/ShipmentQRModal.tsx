import React, { useRef } from 'react';
import { Package, Smartphone, Printer, Download } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  trackingId: string;
  qrCodeBase64: string;
  title?: string;
  subtitle?: string;
  showTrackingLabel?: boolean;
  showActions?: boolean;
  variant?: "default" | "payment";
}

const ShipmentQRModal: React.FC<Props> = ({
  isOpen,
  onClose,
  trackingId,
  qrCodeBase64,
  title = "Código QR del Envío",
  subtitle,
  showTrackingLabel = true,
  showActions = true,
  variant = "default",
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

    printWindow.focus();
    printWindow.print();
    printWindow.onafterprint = () => printWindow.close();
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = `data:image/png;base64,${qrCodeBase64}`;
    link.download = `QR_${trackingId}.png`;
    link.click();
  };

  if (variant === "payment") {
    return (
      <Dialog open={isOpen} onClose={onClose}>
        <DialogContent className="max-w-[400px] text-center">
          <div className="flex flex-col items-center gap-4 p-2">
            <div className="w-14 h-14 rounded-2xl bg-[var(--brand-tint)] flex items-center justify-center">
              <Smartphone className="w-6 h-6 text-[var(--brand)]" />
            </div>
            <div>
              <DialogTitle className="text-center">{title ?? "QR de cobro"}</DialogTitle>
              {subtitle && (
                <p className="text-[13px] text-[var(--text-secondary)] mt-1">{subtitle}</p>
              )}
            </div>
            <div className="rounded-xl border border-[var(--border)] p-4 bg-white">
              <img
                src={`data:image/png;base64,${qrCodeBase64}`}
                alt="QR de pago"
                className="w-56 h-56"
              />
            </div>
            <Button variant="outline" onClick={onClose} className="w-full">Cerrar</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onClose={onClose}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader onClose={onClose}>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            {title}
          </DialogTitle>
        </DialogHeader>

        {subtitle && (
          <p className="px-6 text-[13px] text-[var(--text-secondary)] text-center mb-3">
            {subtitle}
          </p>
        )}

        <div ref={printRef} className="px-6">
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-xl border border-[var(--border)] p-4 bg-white">
              <img
                src={`data:image/png;base64,${qrCodeBase64}`}
                alt={`QR Code ${trackingId}`}
                className="w-64 h-64"
              />
            </div>
            {showTrackingLabel && (
              <div className="text-center">
                <p className="text-xs text-[var(--text-muted)]">Tracking ID</p>
                <p className="text-lg font-mono font-bold text-[var(--text-primary)] tracking-wider">
                  {trackingId}
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-wrap justify-center">
          {showActions && (
            <>
              <Button onClick={handlePrint} className="gap-1.5">
                <Printer className="w-4 h-4" /> Imprimir
              </Button>
              <Button variant="outline" onClick={handleDownload} className="gap-1.5">
                <Download className="w-4 h-4" /> Descargar PNG
              </Button>
            </>
          )}
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ShipmentQRModal;
