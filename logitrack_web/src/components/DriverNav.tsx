import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useOrganizationTheme } from "../context/OrganizationThemeContext";

interface DriverNavProps {
  title: string;
  subtitle?: string;
}

export function DriverNav({ title }: DriverNavProps) {
  const { user } = useAuth();
  const { config: org } = useOrganizationTheme();
  const orgName = org?.name?.trim() || "LogiTrack";
  const logoUrl = org?.logo_url?.trim();

  if (!user) return null;

  const initials = user.username.slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-50 h-14 bg-[var(--sidebar-bg)] text-white flex items-center px-4 gap-3">
      {/* Left: logo + org name */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
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
        <span className="font-extrabold text-[15px] tracking-[0.5px] text-white/90 truncate max-w-[100px]" title={orgName}>
          {orgName}
        </span>
      </div>

      {/* Center: page title */}
      <h1 className="text-[15px] font-bold text-white/90 leading-tight truncate max-w-[160px] text-center shrink-0">
        {title}
      </h1>

      {/* Right: avatar → /profile */}
      <NavLink
        to="/profile"
        className="no-underline shrink-0"
        title={user.username}
      >
        <div className="min-h-[44px] min-w-[44px] rounded-full bg-[var(--brand)] flex items-center justify-center text-white font-bold text-sm">
          {initials}
        </div>
      </NavLink>
    </header>
  );
}
