import { useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { WA_QUICK_MESSAGES, waHrefWithText } from "../../utils/driverActions";

interface Props {
  phone: string;
  recipientName: string;
  trackingId: string;
  compact?: boolean;
}

export function WhatsAppQuickButton({ phone, recipientName, trackingId, compact }: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: MouseEvent | TouchEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("touchstart", onDocPointer);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("touchstart", onDocPointer);
    };
  }, [open]);

  const sizing = compact ? "h-14 gap-0.5" : "h-16 gap-1";
  const iconSize = compact ? "w-4 h-4" : "w-5 h-5";

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`w-full inline-flex flex-col items-center justify-center ${sizing} rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 cursor-pointer`}
      >
        <MessageCircle className={iconSize} />
        <span className="text-[10px] font-bold uppercase tracking-wider">WhatsApp</span>
      </button>
      {open && (
        <div
          className="absolute z-30 left-0 right-0 mt-2 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {WA_QUICK_MESSAGES.map((m) => (
            <a
              key={m.id}
              href={waHrefWithText(phone, m.build(recipientName, trackingId))}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="block px-4 py-3 text-sm text-slate-700 hover:bg-emerald-50 hover:text-emerald-800 border-b border-slate-100 last:border-b-0"
            >
              {m.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
