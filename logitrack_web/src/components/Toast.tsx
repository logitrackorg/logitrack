import { useState, useEffect, useCallback } from "react";

type ToastType = "success" | "error";

interface ToastMessage {
  id: number;
  type: ToastType;
  message: string;
}

let addToastFn: ((type: ToastType, message: string) => void) | null = null;

export function toast(type: ToastType, message: string) {
  addToastFn?.(type, message);
}
toast.success = (message: string) => toast("success", message);
toast.error = (message: string) => toast("error", message);

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  let counter = 0;

  const add = useCallback((type: ToastType, message: string) => {
    const id = ++counter;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  useEffect(() => {
    addToastFn = add;
    return () => { addToastFn = null; };
  }, [add]);

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
