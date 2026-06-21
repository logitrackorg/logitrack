import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { User, LogOut } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useOrganizationTheme } from "../context/OrganizationThemeContext";
import { ThemeToggle } from "./ThemeToggle";

interface DriverNavProps {
  title: string;
  subtitle?: string;
}

export function DriverNav({ title, subtitle }: DriverNavProps) {
  const { user, logout } = useAuth();
  const { config: org } = useOrganizationTheme();
  const orgName = org?.name?.trim() || "LogiTrack";
  const logoUrl = org?.logo_url?.trim();
  const navigate = useNavigate();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [menuOpen]);

  if (!user) return null;

  const initials = user.username.slice(0, 2).toUpperCase();
  const roleLabel = user.driver_type === "intersucursal" ? "Chofer Intersucursal" : "Chofer";

  return (
    <header className="sticky top-0 z-[1000] h-14 bg-[var(--sidebar-bg)] flex items-center px-4 gap-3 pt-[env(safe-area-inset-top,0px)]">
      {/* Left: org logo */}
      {logoUrl ? (
        <img src={logoUrl} alt={orgName} className="w-8 h-8 rounded-lg object-contain shrink-0 bg-white/10" />
      ) : (
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-extrabold text-sm shrink-0">
          {orgName.slice(0, 2).toUpperCase()}
        </div>
      )}

      {/* Center: page title */}
      <div className="flex-1 flex flex-col items-center justify-center min-w-0">
        <h1 className="text-[15px] font-bold text-white leading-tight truncate max-w-full">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[10px] text-white/60 leading-tight truncate max-w-full">{subtitle}</p>
        )}
      </div>

      {/* Right: avatar → dropdown */}
      <div className="relative shrink-0" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="min-h-[44px] min-w-[44px] rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm cursor-pointer border-0"
          aria-label="Abrir menú de usuario"
        >
          {initials}
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-2 w-64 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xl z-50 overflow-hidden">
            {/* Header: nombre + rol + org */}
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <p className="text-sm font-bold text-[var(--text-primary)]">{user.username}</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">{roleLabel}</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">{orgName}</p>
            </div>

            {/* Theme toggle */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)]">
              <span className="text-sm text-[var(--text-primary)]">Modo oscuro</span>
              <ThemeToggle compact />
            </div>

            {/* Mi perfil */}
            <button
              onClick={() => { setMenuOpen(false); navigate("/profile"); }}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-muted)] cursor-pointer border-0 bg-transparent text-left transition-all"
            >
              <User size={16} className="text-[var(--text-secondary)]" />
              Mi perfil
            </button>

            {/* Separator + logout */}
            <div className="border-t border-[var(--border)]">
              <button
                onClick={() => { setMenuOpen(false); logout(); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-[var(--danger-text)] hover:bg-[var(--danger-bg)] cursor-pointer border-0 bg-transparent text-left transition-all"
              >
                <LogOut size={16} />
                Cerrar sesión
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
