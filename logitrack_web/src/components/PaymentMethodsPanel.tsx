import { useEffect, useState } from "react";
import { paymentApi, type Payment, type PaymentConfig } from "../api/payments";
import { Button } from "@/components/ui/button";
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
  const [confirmingTransfer, setConfirmingTransfer] = useState(false);
  const [showTransferConfirm, setShowTransferConfirm] = useState(false);
  const [copiedDest, setCopiedDest] = useState(false);
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig>({ mp_enabled: true, mock_enabled: false, transfer_enabled: false, transfer_holder: "", mp_alias: "", mp_cvu: "" });

  useEffect(() => {
    paymentApi.getConfig().then(setPaymentConfig).catch(() => {});
  }, []);

  const reportError = (msg: string) => {
    onError?.(msg);
  };

  const mpAvailable = Boolean(payment.init_point) && paymentConfig.mp_enabled;

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

  const handleCopyDest = (dest: string) => {
    navigator.clipboard.writeText(dest).then(() => {
      setCopiedDest(true);
      setTimeout(() => setCopiedDest(false), 2000);
    });
  };

  const handleConfirmTransfer = async () => {
    setShowTransferConfirm(false);
    setConfirmingTransfer(true);
    try {
      const result = await paymentApi.confirmTransferPayment(trackingId);
      onCashConfirmed(result.tracking_id);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      reportError(msg ?? "No se pudo registrar la transferencia bancaria.");
      setConfirmingTransfer(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {paymentConfig.mp_enabled && (
        <>
          <MethodCard
            icon="🔗"
            iconBg="var(--info-bg)"
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
            iconBg="var(--info-bg)"
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
        </>
      )}
      <MethodCard
        icon="💵"
        iconBg="var(--ok-bg)"
        title="Pago en efectivo"
        description="El cliente paga presencialmente en la sucursal"
        disabled={confirmingCash}
        action={{
          label: confirmingCash ? "Procesando…" : "Confirmar pago",
          variant: "cash",
          onClick: () => setShowCashConfirm(true),
        }}
      />
      {paymentConfig.transfer_enabled && (
        <TransferCard
          dest={paymentConfig.mp_alias || paymentConfig.mp_cvu}
          holder={paymentConfig.transfer_holder}
          copied={copiedDest}
          confirming={confirmingTransfer}
          onCopyDest={handleCopyDest}
          onConfirm={() => setShowTransferConfirm(true)}
        />
      )}
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
      <TransferConfirmModal
        isOpen={showTransferConfirm}
        amount={payment.amount}
        currency={payment.currency}
        onCancel={() => setShowTransferConfirm(false)}
        onConfirm={handleConfirmTransfer}
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
  const btnVariant = action.variant === "cash" ? "default" : "outline";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
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
        <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)", lineHeight: 1.2 }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.3 }}>
          {description}
        </div>
      </div>
      <Button
        variant={btnVariant}
        size="sm"
        disabled={disabled}
        onClick={action.onClick}
        className="shrink-0"
      >
        {action.label}
      </Button>
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

function TransferCard({
  dest,
  holder,
  copied,
  confirming,
  onCopyDest,
  onConfirm,
}: {
  dest: string;
  holder: string;
  copied: boolean;
  confirming: boolean;
  onCopyDest: (dest: string) => void;
  onConfirm: () => void;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            flex: "0 0 auto",
            width: 40,
            height: 40,
            borderRadius: 10,
            background: "var(--info-bg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
          }}
        >
          🏦
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)", lineHeight: 1.2 }}>
            Transferencia bancaria
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
            Confirmá cuando verifiques la acreditación
          </div>
        </div>
      </div>

      {dest && (
        <div
          style={{
            background: "var(--bg-page)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "8px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {holder && (
            <div>
              <div style={{ fontSize: 10, color: "var(--text-secondary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Titular
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginTop: 2 }}>
                {holder}
              </div>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, color: "var(--text-secondary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Alias / CBU destino
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", fontFamily: "monospace", marginTop: 2, wordBreak: "break-all" }}>
                {dest}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => onCopyDest(dest)}
            >
              {copied ? "✓ Copiado" : "Copiar"}
            </Button>
          </div>
        </div>
      )}

      <Button
        variant="outline"
        className="w-full"
        onClick={onConfirm}
        disabled={confirming}
      >
        {confirming ? "Procesando…" : "Confirmar transferencia"}
      </Button>
    </div>
  );
}

type TransferConfirmModalProps = {
  isOpen: boolean;
  amount: number;
  currency: string;
  onCancel: () => void;
  onConfirm: () => void;
};

function TransferConfirmModal({ isOpen, amount, currency, onCancel, onConfirm }: TransferConfirmModalProps) {
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
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-confirm-title"
        style={{
          width: "100%",
          maxWidth: 420,
          background: "var(--bg-card)",
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
            background: "linear-gradient(180deg, var(--info-bg) 0%, var(--bg-card) 100%)",
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "var(--info-bg)",
              border: "3px solid var(--info-border, var(--info))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 14px",
              fontSize: 32,
            }}
          >
            🏦
          </div>
          <h2
            id="transfer-confirm-title"
            style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.01em" }}
          >
            Confirmar transferencia bancaria
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.45 }}>
            Confirmá que verificaste la acreditación de la transferencia en la cuenta.
          </p>
        </div>

        <div style={{ padding: "0 24px" }}>
          <div
            style={{
              background: "var(--bg-page)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "14px 16px",
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Monto a acreditar
            </span>
            <span style={{ fontSize: 20, color: "var(--text-primary)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {formatted}
            </span>
          </div>
          <div
            style={{
              marginTop: 12,
              padding: "10px 12px",
              borderRadius: 10,
              background: "var(--warn-bg)",
              border: "1px solid var(--warn-border)",
              fontSize: 12,
              color: "var(--warn-text)",
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
          <Button
            variant="outline"
            className="flex-1"
            onClick={onCancel}
          >
            Cancelar
          </Button>
          <Button
            variant="default"
            className="flex-1"
            onClick={onConfirm}
            autoFocus
          >
            Confirmar transferencia
          </Button>
        </div>
      </div>
    </div>
  );
}

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
          background: "var(--bg-card)",
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
            background: "linear-gradient(180deg, var(--ok-bg) 0%, var(--bg-card) 100%)",
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "var(--ok-bg)",
              border: "3px solid var(--ok-border)",
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
              color: "var(--text-primary)",
              letterSpacing: "-0.01em",
            }}
          >
            Confirmar pago en efectivo
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.45 }}>
            Confirmá que el cliente entregó el monto en la sucursal.
          </p>
        </div>

        <div style={{ padding: "0 24px" }}>
          <div
            style={{
              background: "var(--bg-page)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "14px 16px",
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Monto recibido
            </span>
            <span style={{ fontSize: 20, color: "var(--text-primary)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {formatted}
            </span>
          </div>
          <div
            style={{
              marginTop: 12,
              padding: "10px 12px",
              borderRadius: 10,
              background: "var(--warn-bg)",
              border: "1px solid var(--warn-border)",
              fontSize: 12,
              color: "var(--warn-text)",
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
          <Button
            variant="outline"
            className="flex-1"
            onClick={onCancel}
          >
            Cancelar
          </Button>
          <Button
            variant="default"
            className="flex-1"
            onClick={onConfirm}
            autoFocus
          >
            Confirmar pago
          </Button>
        </div>
      </div>
    </div>
  );
}
