import { useState, useEffect, useRef } from "react";
import { setAddToast } from "../utils/toast";

type ToastType = "success" | "error" | "info" | "warning";

interface ToastMessage {
  id: number;
  type: ToastType;
  message: string;
}

const typeStyles: Record<ToastType, string> = {
  success: "border-l-green-500 bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200",
  error: "border-l-red-500 bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200",
  info: "border-l-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-800 dark:text-blue-200",
  warning: "border-l-orange-500 bg-orange-50 dark:bg-orange-950 text-orange-800 dark:text-orange-200",
};

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
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`border-l-4 rounded-lg px-4 py-3 min-w-[260px] max-w-[360px] shadow-lg flex items-center justify-between gap-2 text-sm font-medium ${typeStyles[t.type]}`}
        >
          <span>{t.message}</span>
          <button
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            aria-label="Descartar notificación"
            className="bg-transparent border-none cursor-pointer text-inherit text-base leading-none p-0 opacity-70 hover:opacity-100"
          >×</button>
        </div>
      ))}
    </div>
  );
}
