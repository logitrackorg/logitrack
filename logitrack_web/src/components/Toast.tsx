import { useState, useEffect, useRef } from "react";
import { setAddToast } from "../utils/toast";

type ToastType = "success" | "error";

interface ToastMessage {
  id: number;
  type: ToastType;
  message: string;
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const counter = useRef(0);

  useEffect(() => {
    setAddToast((type, message) => {
      const id = ++counter.current;
      setToasts((prev) => [...prev, { id, type, message }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 5000);
    });
    return () => setAddToast(null);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: "fixed", top: 16, right: 16, zIndex: 9999,
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          padding: "12px 16px",
          borderRadius: 8,
          minWidth: 260,
          maxWidth: 360,
          background: t.type === "success" ? "#166534" : "#991b1b",
          color: "#fff",
          fontSize: 14,
          fontWeight: 500,
          boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
        }}>
          <span>{t.message}</span>
          <button
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}
          >×</button>
        </div>
      ))}
    </div>
  );
}
