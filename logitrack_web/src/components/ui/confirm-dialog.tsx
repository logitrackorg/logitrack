import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "./button";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: (notes?: string) => void;
  onCancel: () => void;
  variant?: "default" | "danger";
  requireComment?: boolean;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  variant = "default",
  requireComment = false,
}: ConfirmDialogProps) {
  const [notes, setNotes] = useState("");

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onCancel();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onCancel]);

  useEffect(() => {
    if (isOpen) setNotes("");
  }, [isOpen]);

  if (!isOpen) return null;

  const trimmedNotes = notes.trim();
  const canConfirm = !requireComment || trimmedNotes.length >= 15;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px",
      }}
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div
        style={{
          background: "var(--bg-card)",
          borderRadius: "12px",
          padding: "24px",
          maxWidth: "420px",
          width: "100%",
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
          animation: "modalSlideIn 0.2s ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`
          @keyframes modalSlideIn {
            from {
              opacity: 0;
              transform: translateY(-20px) scale(0.95);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
        `}</style>

        <div style={{ display: "flex", alignItems: "flex-start", gap: "16px" }}>
          <div
            style={{
              flexShrink: 0,
              width: "48px",
              height: "48px",
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: variant === "danger" ? "var(--warn-bg)" : "var(--brand-tint)",
            }}
          >
            <AlertTriangle
              style={{
                width: "24px",
                height: "24px",
                color: variant === "danger" ? "var(--warn)" : "var(--brand)",
              }}
            />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
              <h2
                id="confirm-dialog-title"
                style={{
                  fontSize: "18px",
                  fontWeight: "700",
                  color: "var(--text-primary)",
                  margin: 0,
                  lineHeight: 1.3,
                }}
              >
                {title}
              </h2>
              <button
                onClick={onCancel}
                style={{
                  flexShrink: 0,
                  background: "none",
                  border: "none",
                  padding: "4px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "6px",
                  color: "var(--text-secondary)",
                  transition: "background 0.2s",
                }}
                aria-label="Cerrar"
              >
                <X style={{ width: "20px", height: "20px" }} />
              </button>
            </div>

            <p
              style={{
                fontSize: "14px",
                color: "var(--text-secondary)",
                marginTop: "8px",
                lineHeight: 1.5,
                margin: "8px 0 0 0",
              }}
            >
              {message}
            </p>
            {requireComment && (
              <div style={{ marginTop: 12 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text-strong)", marginBottom: 6 }}>
                  Comentario obligatorio
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  placeholder="Escribí al menos 15 caracteres con la justificación de la decisión"
                  style={{
                    width: "100%",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    padding: 8,
                    fontSize: 13,
                    resize: "vertical",
                  }}
                />
                <div style={{ marginTop: 6, fontSize: 12, color: canConfirm ? "var(--text-secondary)" : "var(--warn-text)" }}>
                  Mínimo 15 caracteres. Llevás {trimmedNotes.length}/15.
                </div>
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: "12px",
            marginTop: "24px",
            justifyContent: "flex-end",
          }}
        >
          <Button
            size="lg"
            variant="outline"
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            size="lg"
            variant={variant === "danger" ? "destructive" : "default"}
            onClick={() => onConfirm(requireComment ? trimmedNotes : undefined)}
            disabled={!canConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}