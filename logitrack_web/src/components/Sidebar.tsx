import React, { useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useIsMobile } from "../hooks/useIsMobile";
import {
  Truck,
  LayoutDashboard,
  Package,
  Car,
  Building2,
  Upload,
  Settings,
  Users,
  ScrollText,
  LogOut,
  Building,
  Cpu,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
} from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  operator: "Operador",
  supervisor: "Supervisor",
  manager: "Gerente",
  admin: "Administrador",
  driver: "Chofer",
};

const ROLE_STYLES: Record<string, string> = {
  operator: "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30",
  supervisor: "bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/30",
  manager: "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30",
  admin: "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/30",
  driver: "bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/30",
};

interface NavItemProps {
  to: string;
  icon: React.ElementType;
  label: string;
  end?: boolean;
  collapsed?: boolean;
}

function NavItem({ to, icon: Icon, label, end, collapsed }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg text-sm font-medium transition-all duration-200 group ${
          isActive
            ? "bg-orange-500/20 text-orange-300 border-r-2 border-orange-500"
            : "text-slate-400 hover:text-white hover:bg-white/5"
        } ${collapsed ? "justify-center p-2" : "px-3 py-2.5"}`
      }
      title={collapsed ? label : undefined}>
      <Icon className={`w-5 h-5 flex-shrink-0 ${collapsed ? "" : "group-hover:scale-110 transition-transform"}`} />
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  );
}

interface SidebarProps {
  onToggle?: () => void;
  collapsed?: boolean;
}

export function Sidebar({ onToggle, collapsed = false }: SidebarProps) {
  const { user, logout, hasRole } = useAuth();
  const isMobile = useIsMobile();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!user) return null;

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center shadow-sm shadow-orange-500/30">
            <Truck className="w-5 h-5 text-white" />
          </div>
          {!collapsed && <span className="font-bold text-white text-lg tracking-tight">LogiTrack</span>}
        </div>
        {!isMobile && (
          <button
            onClick={onToggle}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors">
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        )}
        {isMobile && (
          <button
            onClick={() => setMobileOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {hasRole("supervisor", "manager", "admin") && (
          <NavItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" collapsed={collapsed} />
        )}
        {!hasRole("admin") && <NavItem to="/" icon={Package} label="Envíos" end collapsed={collapsed} />}
        {hasRole("operator", "supervisor", "manager", "admin") && (
          <NavItem to="/vehicles" icon={Car} label="Flota" collapsed={collapsed} />
        )}
        {hasRole("supervisor", "manager", "admin") && (
          <NavItem to="/branches" icon={Building2} label="Sucursales" collapsed={collapsed} />
        )}
        {hasRole("operator", "supervisor") && (
          <NavItem to="/bulk-upload" icon={Upload} label="Importar" collapsed={collapsed} />
        )}

        {/* Admin section */}
        {hasRole("admin") && (
          <>
            <div className={`px-3 py-2 ${collapsed ? "text-center" : ""}`}>
              <div className="w-full h-px bg-white/10"></div>
            </div>
            <NavItem to="/ml-config" icon={Cpu} label="ML Config" collapsed={collapsed} />
            <NavItem to="/system-config" icon={Settings} label="Sistema" collapsed={collapsed} />
            <NavItem to="/organization" icon={Building} label="Organización" collapsed={collapsed} />
            <NavItem to="/admin/users" icon={Users} label="Usuarios" collapsed={collapsed} />
            <NavItem to="/admin/access-logs" icon={ScrollText} label="Accesos" collapsed={collapsed} />
          </>
        )}
      </nav>

      {/* User section */}
      <div className={`border-t border-white/10 ${collapsed ? "p-2" : "p-4"}`}>
        <NavLink
          to="/profile"
          className={`flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors mb-2 ${collapsed ? "justify-center" : ""}`}>
          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0">
            <span className="text-sm font-bold text-white uppercase">{user.username[0]}</span>
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-200 truncate">{user.username}</div>
              <div className={`text-xs font-semibold px-2 py-0.5 rounded-md w-fit ${ROLE_STYLES[user.role]}`}>
                {ROLE_LABELS[user.role]}
              </div>
            </div>
          )}
        </NavLink>
        <button
          onClick={logout}
          className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors text-sm ${collapsed ? "justify-center px-2" : ""}`}>
          <LogOut className="w-4 h-4" />
          {!collapsed && <span>Salir</span>}
        </button>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <>
        {/* Mobile menu button */}
        <button
          onClick={() => setMobileOpen(true)}
          className="fixed top-4 left-4 z-50 p-2 bg-slate-800 text-white rounded-lg shadow-lg md:hidden">
          <Menu className="w-5 h-5" />
        </button>

        {/* Mobile sidebar overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
            <div className="absolute left-0 top-0 h-full w-64 bg-slate-800 shadow-xl">{sidebarContent}</div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className={`bg-slate-800 border-r border-white/10 transition-all duration-300 ${collapsed ? "w-16" : "w-64"}`}>
      {sidebarContent}
    </div>
  );
}
