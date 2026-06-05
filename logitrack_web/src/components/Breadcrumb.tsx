import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="flex items-center gap-1.5 text-sm text-slate-500 mb-4" aria-label="Breadcrumb">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
          {item.to ? (
            <Link to={item.to} className="text-blue-600 hover:text-blue-800 transition-colors font-medium">
              {item.label}
            </Link>
          ) : (
            <span className="text-slate-900 font-semibold">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
