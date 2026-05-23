import { useEffect, useState } from "react";
import { paymentApi, type Payment } from "../api/payments";
import ShipmentQRModal from "./ShipmentQRModal";

type Props = {
  payment: Payment;
  trackingId: string;
  onCashConfirmed: (newTrackingId: string) => void;
  onError?: (msg: string) => void;
};

export default function PaymentMethodsPanel({
  payment,
  trackingId,
  onCashConfirmed,
  onError,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [loadingQR, setLoadingQR] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [qrBase64, setQrBase64] = useState("");
  const [confirmingCash, setConfirmingCash] = useState(false);
  const [showCashConfirm, setShowCashConfirm] = useState(false);

  const reportError = (msg: string) => {
    onError?.(msg);
  };

  const mpAvailable = Boolean(payment.init_point);

  const handleCopyLink = () => {
    if (!payment.init_point) return;
    navigator.clipboard.writeText(payment.init_point).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleShowQR = async () => {
    if (!mpAvailable) return;
    setLoadingQR(true);
    try {
      const { qr_code_base64 } = await paymentApi.getQR(trackingId);
      setQrBase64(qr_code_base64);
      setShowQR(true);
    } catch {
      reportError("No se pudo generar el QR de pago.");
    } finally {
      setLoadingQR(false);
    }
  };

  const handleConfirmCash = async () => {
    setShowCashConfirm(false);
    setConfirmingCash(true);
    try {
      const result = await paymentApi.confirmCashPayment(trackingId);
      onCashConfirmed(result.tracking_id);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      reportError(msg ?? "No se pudo registrar el pago en efectivo.");
      setConfirmingCash(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <MethodCard
        icon="🔗"
        iconBg="#e0f2fe"
        title="Link de Mercado Pago"
        description={
          mpAvailable
            ? "Compartí el link por WhatsApp, email o chat"
            : "Mercado Pago no está disponible en este entorno"
        }
        disabled={!mpAvailable}
        action={{
          label: copied ? "✓ Copiado" : "Copiar link",
          variant: copied ? "success" : "primary",
          onClick: handleCopyLink,
        }}
      />
      <MethodCard
        icon="📱"
        iconBg="#e0f2fe"
        title="QR de cobro"
        description={
          mpAvailable
            ? "El cliente escanea desde su celular"
            : "Mercado Pago no está disponible en este entorno"
        }
        disabled={!mpAvailable || loadingQR}
        action={{
          label: loadingQR ? "Generando…" : "Mostrar QR",
          variant: "primary",
          onClick: handleShowQR,
        }}
      />
      <MethodCard
        icon="💵"
        iconBg="#dcfce7"
        title="Pago en efectivo"
        description="El cliente paga presencialmente en la sucursal"
        disabled={confirmingCash}
        action={{
          label: confirmingCash ? "Procesando…" : "Confirmar pago",
          variant: "cash",
          onClick: () => setShowCashConfirm(true),
        }}
      />
      <ShipmentQRModal
        isOpen={showQR}
        onClose={() => setShowQR(false)}
        trackingId={trackingId}
        qrCodeBase64={qrBase64}
        title="💳 QR de cobro"
        subtitle="El cliente puede escanear este código con su celular para completar el pago."
        variant="payment"
      />
      <CashConfirmModal
        isOpen={showCashConfirm}
        amount={payment.amount}
        currency={payment.currency}
        onCancel={() => setShowCashConfirm(false)}
        onConfirm={handleConfirmCash}
      />
    </div>
  );
}

type MethodCardProps = {
  icon: string;
  iconBg: string;
  title: string;
  description: string;
  disabled?: boolean;
  action: {
    label: string;
    variant: "primary" | "success" | "cash";
    onClick: () => void;
  };
};

function MethodCard({ icon, iconBg, title, description, disabled, action }: MethodCardProps) {
  const variantStyles: Record<MethodCardProps["action"]["variant"], { bg: string; color: string; border: string }> = {
    primary: { bg: "#fff", color: "#009ee3", border: "#009ee3" },
    success: { bg: "#f0fdf4", color: "#16a34a", border: "#86efac" },
    cash:    { bg: "#16a34a", color: "#fff",    border: "#16a34a" },
  };
  const v = variantStyles[action.variant];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 10,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <div
        style={{
          flex: "0 0 auto",
          width: 40,
          height: 40,
          borderRadius: 10,
          background: iconBg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "#1e293b", lineHeight: 1.2 }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 2, lineHeight: 1.3 }}>
          {description}
        </div>
      </div>
      <button
        onClick={action.onClick}
        disabled={disabled}
        style={{
          flex: "0 0 auto",
          background: v.bg,
          color: v.color,
          border: `1px solid ${v.border}`,
          borderRadius: 8,
          padding: "8px 14px",
          fontWeight: 700,
          fontSize: 13,
          cursor: disabled ? "not-allowed" : "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {action.label}
      </button>
    </div>
  );
}

type CashConfirmModalProps = {
  isOpen: boolean;
  amount: number;
  currency: string;
  onCancel: () => void;
  onConfirm: () => void;
};

function CashConfirmModal({ isOpen, amount, currency, onCancel, onConfirm }: CashConfirmModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const formatted = new Intl.NumberFormat("es-AR", { style: "currency", currency: currency || "ARS" }).format(amount);

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.55)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
        padding: 16,
        animation: "logitrack-cash-fade 160ms ease-out",
      }}
    >
      <style>{`
        @keyframes logitrack-cash-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes logitrack-cash-pop {
          from { opacity: 0; transform: translateY(8px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cash-confirm-title"
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#fff",
          borderRadius: 18,
          boxShadow: "0 24px 70px rgba(15, 23, 42, 0.35)",
          overflow: "hidden",
          animation: "logitrack-cash-pop 180ms ease-out",
        }}
      >
        <div
          style={{
            padding: "28px 24px 20px",
            textAlign: "center",
            background: "linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%)",
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "#dcfce7",
              border: "3px solid #bbf7d0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 14px",
              fontSize: 32,
            }}
          >
            💵
          </div>
          <h2
            id="cash-confirm-title"
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 700,
              color: "#0f172a",
              letterSpacing: "-0.01em",
            }}
          >
            Confirmar pago en efectivo
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#64748b", lineHeight: 1.45 }}>
            Confirmá que el cliente entregó el monto en la sucursal.
          </p>
        </div>

        <div style={{ padding: "0 24px" }}>
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 12,
              padding: "14px 16px",
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Monto recibido
            </span>
            <span style={{ fontSize: 20, color: "#0f172a", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {formatted}
            </span>
          </div>
          <div
            style={{
              marginTop: 12,
              padding: "10px 12px",
              borderRadius: 10,
              background: "#fffbeb",
              border: "1px solid #fde68a",
              fontSize: 12,
              color: "#92400e",
              lineHeight: 1.4,
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
            }}
          >
            <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>⚠️</span>
            <span>
              Esta acción <strong>confirma el envío</strong> y no puede revertirse.
            </span>
          </div>
        </div>

        <div style={{ padding: "20px 24px 24px", display: "flex", gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: "1px solid #e2e8f0",
              background: "#fff",
              color: "#475569",
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: "none",
              background: "#16a34a",
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
              boxShadow: "0 6px 16px rgba(22, 163, 74, 0.32)",
            }}
          >
            Confirmar pago
          </button>
        </div>
      </div>
    </div>
  );
}
