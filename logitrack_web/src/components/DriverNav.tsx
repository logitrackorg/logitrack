import { NavLink } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useOrganizationTheme } from "../context/OrganizationThemeContext";
import { ThemeToggle } from "./ThemeToggle";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "../hooks/useIsMobile";

interface DriverNavProps {
  title: string;
  subtitle?: string;
}

export function DriverNav({ title, subtitle }: DriverNavProps) {
  const { user, logout } = useAuth();
  const { config: org } = useOrganizationTheme();
  const orgName = org?.name?.trim() || "LogiTrack";
  const logoUrl = org?.logo_url?.trim();
  const isMobile = useIsMobile();

  if (!user) return null;

  const isInterBranch = user.driver_type === "intersucursal";
  const roleLabel = isInterBranch ? "Chofer Intersucursal" : "Chofer";

  return (
    <header className="sticky top-0 z-50 h-14 bg-[var(--sidebar-bg)] text-white flex items-center px-4 gap-3 min-h-[56px] py-2">
      {/* Logo + org name */}
      <div className="flex items-center gap-2.5 min-w-0 shrink">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={orgName}
            className="w-8 h-8 rounded-lg object-contain shrink-0 bg-white/10"
          />
        ) : (
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-extrabold text-sm shrink-0">
            {orgName.slice(0, 2).toUpperCase()}
          </div>
        )}
        <span className="font-extrabold text-[15px] tracking-[0.5px] text-white/90 truncate max-w-[120px]" title={orgName}>
          {orgName}
        </span>
      </div>

      {/* Navigation link */}
      {isInterBranch ? (
        <NavLink
          to="/driver/trip"
          className={({ isActive }) =>
            `no-underline font-semibold text-base min-h-[44px] flex items-center ${isActive ? "text-white" : "text-slate-300"}`
          }
        >
          Mi viaje
        </NavLink>
      ) : (
        <NavLink
          to="/driver/route"
          className={({ isActive }) =>
            `no-underline font-semibold text-base min-h-[44px] flex items-center ${isActive ? "text-white" : "text-slate-300"}`
          }
        >
          Mi ruta
        </NavLink>
      )}

      <div className="flex-1" />

      {/* Controls */}
      <div className="flex items-center gap-2">
        <ThemeToggle compact={isMobile} />
        <NavLink to="/profile" className="no-underline">
          <span className="text-[13px] text-slate-400">
            <strong className="text-slate-200 font-semibold">{user.username}</strong>
            {" · "}
            <span className="text-slate-400 bg-black/20 px-2 py-0.5 rounded-[10px] text-xs">
              {roleLabel}
            </span>
          </span>
        </NavLink>
        <Button
          variant="ghost"
          size="icon"
          onClick={logout}
          className="min-h-11 min-w-11 border border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-md"
          title="Cerrar sesión"
        >
          <LogOut size={18} />
        </Button>
      </div>
    </header>
  );
}
