import { NavLink } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useOrganizationTheme } from "../context/OrganizationThemeContext";
import { ThemeToggle } from "./ThemeToggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DriverNavProps {
  title: string;
  subtitle?: string;
}

export function DriverNav({ title, subtitle }: DriverNavProps) {
  const { user, logout } = useAuth();
  const { config: org } = useOrganizationTheme();
  const orgName = org?.name?.trim() || "LogiTrack";
  const logoUrl = org?.logo_url?.trim();

  if (!user) return null;

  const isInterBranch = user.driver_type === "intersucursal";
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "no-underline font-semibold text-base py-2",
      isActive ? "text-[var(--brand)]" : "text-[var(--text-secondary)]"
    );

  const roleLabel = isInterBranch ? "Chofer Intersucursal" : "Chofer";

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-50 h-14",
          "bg-[var(--topbar-bg)]",
          "backdrop-saturate-[1.8] backdrop-blur-lg",
          "border-b border-[var(--border)]",
          "grid grid-cols-[1fr_auto_1fr] items-center gap-4",
          "px-4"
        )}
      >
        {/* Left: org logo or name */}
        <div className="flex items-center min-w-0">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={orgName}
              className="h-7 w-auto rounded"
            />
          ) : (
            <span className="font-extrabold text-[15px] tracking-[1px] text-[var(--text-primary)]">
              {orgName}
            </span>
          )}
        </div>

        {/* Center: page title + optional subtitle */}
        <div className="min-w-0 flex flex-col items-center">
          <h1 className="text-[15px] font-bold text-[var(--text-primary)] leading-tight truncate max-w-[180px] sm:max-w-[320px]">
            {title}
          </h1>
          {subtitle && (
            <p className="text-[11px] text-[var(--text-muted)] truncate">
              {subtitle}
            </p>
          )}
        </div>

        {/* Right: ThemeToggle + username badge + logout */}
        <div className="flex items-center gap-2 justify-end">
          <ThemeToggle compact />
          <NavLink to="/profile" className="no-underline">
            <span className="text-[13px] text-[var(--text-secondary)]">
              <strong className="text-[var(--text-strong)] font-semibold">
                {user.username}
              </strong>
              {" · "}
              <span className="bg-[var(--bg-muted)] text-[var(--text-muted)] px-2 py-0.5 rounded-[10px] text-xs">
                {roleLabel}
              </span>
            </span>
          </NavLink>
          <Button
            variant="ghost"
            size="icon"
            onClick={logout}
            className="min-h-11 min-w-11 border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)] rounded-md"
            title="Cerrar sesión"
          >
            <LogOut size={18} />
          </Button>
        </div>
      </header>

      {/* Navigation links */}
      <nav className="bg-[var(--bg-card)] border-b border-[var(--border)] px-4">
        {isInterBranch ? (
          <NavLink to="/driver/trip" className={linkClass}>
            Mi viaje
          </NavLink>
        ) : (
          <NavLink to="/driver/route" className={linkClass}>
            Mi ruta
          </NavLink>
        )}
      </nav>
    </>
  );
}
