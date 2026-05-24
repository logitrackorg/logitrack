import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import { useState } from "react";
import { Users, AlertTriangle, DollarSign, BarChart3, Clock, Undo2, TrendingUp, ChevronDown } from "lucide-react";
import { ToastContainer } from "./components/Toast";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { useIsMobile } from "./hooks/useIsMobile";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { NotificationBell } from "./components/NotificationBell";
import { NotificationsPage } from "./pages/NotificationsPage";
import { Dashboard } from "./pages/Dashboard";
import { KpiDetail } from "./pages/KpiDetail";
import { ShipmentList } from "./pages/ShipmentList";
import { ShipmentDetail } from "./pages/ShipmentDetail";
import { NewShipment } from "./pages/NewShipment";
import { PublicTracking } from "./pages/PublicTracking";
import { Login } from "./pages/Login";
import { DriverRoute } from "./pages/DriverRoute";
import { DriverInterBranchTrip } from "./pages/DriverInterBranchTrip";
import { DriverShipmentDetail } from "./pages/DriverShipmentDetail";
import { VehicleList } from "./pages/VehicleList";
import { BranchList } from "./pages/BranchList";
import { MLConfig } from "./pages/MLConfig";
import { SystemConfig } from "./pages/SystemConfig";
import { PricingConfig } from "./pages/PricingConfig";
import { RoutingConfig } from "./pages/RoutingConfig";
import { OrganizationConfig } from "./pages/OrganizationConfig";
import { AdminUsers } from "./pages/AdminUsers";
import { BulkUpload } from "./pages/BulkUpload";
import { AccessLog } from "./pages/AccessLog";
import { UserProfile } from "./pages/UserProfile";
import { DraftList } from "./pages/DraftList";
import { ZoneManagement } from "./pages/ZoneManagement";
import { FatigueConfig } from "./pages/FatigueConfig";
import { SupervisorFatigue } from "./pages/SupervisorFatigue";
import DriverScanVehicle from "./pages/DriverScanVehicle";
import { Repartos } from "./pages/Repartos";
import OperatorTripReception from "./pages/OperatorTripReception";
import { InterSucursal } from "./pages/InterSucursal";
import { InterBranchTripsList } from "./pages/InterBranchTripsList";
import { ReportDrivers } from "./pages/ReportDrivers";
import { ReportIncidents } from "./pages/ReportIncidents";
import { ReportBilling } from "./pages/ReportBilling";
import { ReportRanking } from "./pages/ReportRanking";
import { ReportVolumeByWindow } from "./pages/ReportVolumeByWindow";
import { ReportReturnMetrics } from "./pages/ReportReturnMetrics";
import { ReportSuccessRate } from "./pages/ReportSuccessRate";

const ROLE_LABELS: Record<string, string> = {
  operator: "Operador",
  supervisor: "Supervisor",
  manager: "Gerente",
  admin: "Administrador",
  driver: "Chofer",
};

function Nav() {
  const { user, logout, hasRole } = useAuth();
  const isMobile = useIsMobile();
  const [reportesOpen, setReportesOpen] = useState(false);
  if (!user) return null;

  const reportItems = [
    { label: "Rendimiento de Choferes", icon: <Users className="w-4 h-4" />, to: "/reports/drivers" },
    { label: "Reclamos por Sucursal", icon: <AlertTriangle className="w-4 h-4" />, to: "/reports/incidents" },
    { label: "Métricas de Facturación", icon: <DollarSign className="w-4 h-4" />, to: "/reports/billing" },
    { label: "Ranking de Sucursales", icon: <BarChart3 className="w-4 h-4" />, to: "/reports/branch-ranking" },
    { label: "Volumen por Ventana", icon: <Clock className="w-4 h-4" />, to: "/reports/volume-by-window" },
    { label: "Métricas de Retorno", icon: <Undo2 className="w-4 h-4" />, to: "/reports/return-metrics" },
    { label: "Tasa de Éxito por Sucursal", icon: <TrendingUp className="w-4 h-4" />, to: "/reports/success-rate" },
  ];

  return (
    <nav style={{
      background: "#1e3a5f", color: "#fff",
      padding: isMobile ? "8px 12px" : "0 24px",
      display: "flex", alignItems: "center",
      gap: isMobile ? 10 : 24,
      minHeight: 52, flexWrap: "wrap", rowGap: 6,
    }}>
      <span style={{ fontWeight: 800, fontSize: isMobile ? 15 : 17, letterSpacing: 1 }}>LogiTrack</span>

      {hasRole("supervisor", "manager") && (
        <NavLink to="/dashboard" style={navStyle}>Dashboard</NavLink>
      )}

      {hasRole("supervisor", "manager", "admin") && (
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setReportesOpen(!reportesOpen)}
            style={{
              background: "none", border: "none", color: reportesOpen ? "#93c5fd" : "#cbd5e1",
              fontWeight: 500, fontSize: 14, cursor: "pointer", padding: 0,
              display: "flex", alignItems: "center", gap: 3,
              fontFamily: "inherit",
            }}
          >
            Reportes <ChevronDown className="w-3.5 h-3.5" style={{ transition: "transform 0.15s", transform: reportesOpen ? "rotate(180deg)" : "rotate(0deg)" }} />
          </button>
          {reportesOpen && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 9 }} onClick={() => setReportesOpen(false)} />
              <div style={{
                position: "absolute", top: "100%", left: 0, zIndex: 10,
                background: "#fff", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                minWidth: 260, padding: "6px 0", marginTop: 8,
              }}>
                {reportItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setReportesOpen(false)}
                    style={({ isActive }: { isActive: boolean }): React.CSSProperties => ({
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 14px",
                      color: isActive ? "#1e3a5f" : "#475569",
                      background: isActive ? "#eff6ff" : "transparent",
                      textDecoration: "none", fontSize: 13, fontWeight: isActive ? 600 : 400,
                      transition: "background 0.1s",
                    })}
                    onMouseEnter={(e) => { if (!e.currentTarget.classList.contains("active")) e.currentTarget.style.background = "#f1f5f9"; }}
                    onMouseLeave={(e) => { if (!e.currentTarget.classList.contains("active")) e.currentTarget.style.background = "transparent"; }}
                  >
                    {item.icon}
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {hasRole("supervisor", "manager") && (
        <NavLink to="/supervisor/fatigue" style={navStyle}>Fatiga</NavLink>
      )}
      {!hasRole("admin") && (
        <NavLink to="/" end style={navStyle}>Envíos</NavLink>
      )}
      {hasRole("operator", "supervisor", "manager", "admin") && (
        <NavLink to="/vehicles" style={navStyle}>Flota</NavLink>
      )}
      {hasRole("supervisor", "manager", "admin") && (
        <NavLink to="/branches" style={navStyle}>Sucursales</NavLink>
      )}
      {hasRole("operator", "supervisor", "manager") && (
        <NavLink to="/repartos" style={navStyle}>Repartos</NavLink>
      )}
      {hasRole("operator", "supervisor", "manager") && (
        <NavLink to="/inter-sucursal" style={navStyle}>Inter-sucursal</NavLink>
      )}
      {hasRole("operator", "supervisor", "manager") && (
        <NavLink to="/viajes" style={navStyle}>Viajes</NavLink>
      )}
      {hasRole("admin") && (
        <NavLink to="/zones" style={navStyle}>Zonas</NavLink>
      )}
      {hasRole("operator", "supervisor") && (
        <NavLink to="/bulk-upload" style={navStyle}>Importar CSV</NavLink>
      )}
      {hasRole("admin") && (
        <NavLink to="/ml-config" style={navStyle}>Config. ML</NavLink>
      )}
      {hasRole("admin") && (
        <NavLink to="/fatigue-config" style={navStyle}>Config. fatiga</NavLink>
      )}
      {hasRole("admin") && (
        <NavLink to="/routing-config" style={navStyle}>Config. ruteo</NavLink>
      )}
      {hasRole("admin") && (
        <NavLink to="/system-config" style={navStyle}>Config. sistema</NavLink>
      )}
      {hasRole("admin") && (
        <NavLink to="/pricing-config" style={navStyle}>Tarifario</NavLink>
      )}
      {hasRole("admin") && (
        <NavLink to="/organization" style={navStyle}>Organización</NavLink>
      )}
      {hasRole("admin") && (
        <NavLink to="/admin/users" style={navStyle}>Usuarios</NavLink>
      )}
      {hasRole("admin") && (
        <NavLink to="/admin/access-logs" style={navStyle}>Log de accesos</NavLink>
      )}

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: isMobile ? 8 : 14 }}>
        <NotificationBell />
        {isMobile ? (
          <NavLink to="/profile" style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600, textDecoration: "none" }}>{user.username}</NavLink>
        ) : (
          <NavLink to="/profile" style={{ fontSize: 13, color: "#94a3b8", textDecoration: "none" }}>
            <strong style={{ color: "#e2e8f0" }}>{user.username}</strong>
            {" · "}
            <span style={{ color: "#64748b", background: "#0f2744", padding: "2px 8px", borderRadius: 10, fontSize: 11 }}>
              {ROLE_LABELS[user.role]}
            </span>
          </NavLink>
        )}
        <button onClick={logout}
          style={{ background: "none", border: "1px solid #334155", color: "#94a3b8", borderRadius: 6, padding: isMobile ? "4px 8px" : "4px 12px", cursor: "pointer", fontSize: isMobile ? 12 : 13 }}>
          {isMobile ? "✕" : "Cerrar sesión"}
        </button>
      </div>
    </nav>
  );
}

function DriverNav() {
  const { user, logout } = useAuth();
  const isMobile = useIsMobile();
  if (!user) return null;

  const isInterBranch = user.driver_type === "intersucursal";

  return (
    <nav style={{
      background: "#1e3a5f", color: "#fff",
      padding: isMobile ? "8px 12px" : "0 24px",
      display: "flex", alignItems: "center",
      gap: isMobile ? 10 : 24,
      minHeight: 52,
    }}>
      <span style={{ fontWeight: 800, fontSize: isMobile ? 15 : 17, letterSpacing: 1 }}>LogiTrack</span>
      {isInterBranch ? (
        <NavLink to="/driver/trip" style={navStyle}>Mi viaje</NavLink>
      ) : (
        <NavLink to="/driver/route" style={navStyle}>Mi ruta</NavLink>
      )}

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: isMobile ? 8 : 14 }}>
        {isMobile ? (
          <span style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600 }}>{user.username}</span>
        ) : (
          <span style={{ fontSize: 13, color: "#94a3b8" }}>
            <strong style={{ color: "#e2e8f0" }}>{user.username}</strong>
            {" · "}
            <span style={{ color: "#64748b", background: "#0f2744", padding: "2px 8px", borderRadius: 10, fontSize: 11 }}>
              {isInterBranch ? "Chofer Intersucursal" : "Chofer"}
            </span>
          </span>
        )}
        <button onClick={logout}
          style={{ background: "none", border: "1px solid #334155", color: "#94a3b8", borderRadius: 6, padding: isMobile ? "4px 8px" : "4px 12px", cursor: "pointer", fontSize: isMobile ? 12 : 13 }}>
          {isMobile ? "✕" : "Cerrar sesión"}
        </button>
      </div>
    </nav>
  );
}

function AppRoutes() {
  const { user } = useAuth();

  if (user?.role === "driver") {
    const isInterBranch = user.driver_type === "intersucursal";
    const defaultPath = isInterBranch ? "/driver/scan" : "/driver/route";

    return (
      <>
        <DriverNav />
        <main>
          <Routes>
            <Route path="/driver/route" element={
              <ProtectedRoute roles={["driver"]}>
                <DriverRoute />
              </ProtectedRoute>
            } />
            <Route path="/driver/trip" element={
              <ProtectedRoute roles={["driver"]}>
                <DriverInterBranchTrip />
              </ProtectedRoute>
            } />
            <Route path="/driver/scan" element={
              <ProtectedRoute roles={["driver"]}>
                <DriverScanVehicle />
              </ProtectedRoute>
            } />
            <Route path="/shipments/:trackingId" element={
              <ProtectedRoute roles={["driver"]}>
                <DriverShipmentDetail />
              </ProtectedRoute>
            } />
            <Route path="*" element={<Navigate to={defaultPath} replace />} />
          </Routes>
        </main>
      </>
    );
  }

  return (
    <>
      <Nav />
      <main>
        <Routes>
          <Route path="/login" element={user ? <Navigate to={user.role === "admin" ? "/admin/users" : user.role === "manager" ? "/dashboard" : "/"} replace /> : <Login />} />

          <Route path="/dashboard" element={
            <ProtectedRoute roles={["supervisor", "manager"]}>
              <Dashboard />
            </ProtectedRoute>
          } />

          <Route path="/kpi-detail" element={
            <ProtectedRoute roles={["supervisor", "manager"]}>
              <KpiDetail />
            </ProtectedRoute>
          } />
          <Route path="/" element={
            <ProtectedRoute roles={["operator", "supervisor", "manager"]}>
              <ShipmentList />
            </ProtectedRoute>
          } />

          <Route path="/shipments/:trackingId" element={
            <ProtectedRoute roles={["operator", "supervisor", "manager"]}>
              <ShipmentDetail />
            </ProtectedRoute>
          } />

          <Route path="/inter-branch-trips/:id/recepcion" element={
            <ProtectedRoute roles={["operator", "supervisor"]}>
              <OperatorTripReception />
            </ProtectedRoute>
          } />

          <Route path="/new" element={
            <ProtectedRoute roles={["operator", "supervisor"]}>
              <NewShipment />
            </ProtectedRoute>
          } />

          <Route path="/drafts" element={
            <ProtectedRoute roles={["operator", "supervisor"]}>
              <DraftList />
            </ProtectedRoute>
          } />

          <Route path="/vehicles" element={
            <ProtectedRoute roles={["operator", "supervisor", "manager", "admin"]}>
              <VehicleList />
            </ProtectedRoute>
          } />

          <Route path="/branches" element={
            <ProtectedRoute roles={["supervisor", "manager", "admin"]}>
              <BranchList />
            </ProtectedRoute>
          } />

          <Route path="/ml-config" element={
            <ProtectedRoute roles={["admin"]}>
              <MLConfig />
            </ProtectedRoute>
          } />

          <Route path="/system-config" element={
            <ProtectedRoute roles={["admin"]}>
              <SystemConfig />
            </ProtectedRoute>
          } />

          <Route path="/pricing-config" element={
            <ProtectedRoute roles={["admin"]}>
              <PricingConfig />
            </ProtectedRoute>
          } />

          <Route path="/repartos" element={
            <ProtectedRoute roles={["operator", "supervisor", "manager"]}>
              <Repartos />
            </ProtectedRoute>
          } />

          <Route path="/inter-sucursal" element={
            <ProtectedRoute roles={["operator", "supervisor", "manager"]}>
              <InterSucursal />
            </ProtectedRoute>
          } />

          <Route path="/viajes" element={
            <ProtectedRoute roles={["operator", "supervisor", "manager"]}>
              <InterBranchTripsList />
            </ProtectedRoute>
          } />

          <Route path="/reports/drivers" element={
            <ProtectedRoute roles={["supervisor", "manager", "admin"]}>
              <ReportDrivers />
            </ProtectedRoute>
          } />
          <Route path="/reports/incidents" element={
            <ProtectedRoute roles={["supervisor", "manager", "admin"]}>
              <ReportIncidents />
            </ProtectedRoute>
          } />
          <Route path="/reports/billing" element={
            <ProtectedRoute roles={["supervisor", "manager", "admin"]}>
              <ReportBilling />
            </ProtectedRoute>
          } />
          <Route path="/reports/branch-ranking" element={
            <ProtectedRoute roles={["supervisor", "manager", "admin"]}>
              <ReportRanking />
            </ProtectedRoute>
          } />
          <Route path="/reports/volume-by-window" element={
            <ProtectedRoute roles={["supervisor", "manager", "admin"]}>
              <ReportVolumeByWindow />
            </ProtectedRoute>
          } />
          <Route path="/reports/return-metrics" element={
            <ProtectedRoute roles={["supervisor", "manager", "admin"]}>
              <ReportReturnMetrics />
            </ProtectedRoute>
          } />
          <Route path="/reports/success-rate" element={
            <ProtectedRoute roles={["supervisor", "manager", "admin"]}>
              <ReportSuccessRate />
            </ProtectedRoute>
          } />

          {/* Legacy redirects */}
          <Route path="/routing" element={<Navigate to="/inter-sucursal" replace />} />
          <Route path="/operations/trips" element={<Navigate to="/viajes" replace />} />

          <Route path="/routing-config" element={
            <ProtectedRoute roles={["admin"]}>
              <RoutingConfig />
            </ProtectedRoute>
          } />

          <Route path="/fatigue-config" element={
            <ProtectedRoute roles={["admin"]}>
              <FatigueConfig />
            </ProtectedRoute>
          } />

          <Route path="/supervisor/fatigue" element={
            <ProtectedRoute roles={["supervisor", "manager"]}>
              <SupervisorFatigue />
            </ProtectedRoute>
          } />

          <Route path="/zones" element={
            <ProtectedRoute roles={["admin"]}>
              <ZoneManagement />
            </ProtectedRoute>
          } />

          <Route path="/organization" element={
            <ProtectedRoute roles={["admin"]}>
              <OrganizationConfig />
            </ProtectedRoute>
          } />

          <Route path="/admin/users" element={
            <ProtectedRoute roles={["admin"]}>
              <AdminUsers />
            </ProtectedRoute>
          } />

          <Route path="/bulk-upload" element={
            <ProtectedRoute roles={["operator", "supervisor"]}>
              <BulkUpload />
            </ProtectedRoute>
          } />

          <Route path="/admin/access-logs" element={
            <ProtectedRoute roles={["admin"]}>
              <AccessLog />
            </ProtectedRoute>
          } />

          <Route path="/profile" element={
            <ProtectedRoute>
              <UserProfile />
            </ProtectedRoute>
          } />

          <Route path="/notifications" element={
            <ProtectedRoute roles={["operator", "supervisor", "manager", "admin"]}>
              <NotificationsPage />
            </ProtectedRoute>
          } />

          <Route path="*" element={<Navigate to={user?.role === "admin" ? "/admin/users" : "/"} replace />} />
        </Routes>
      </main>
      <ToastContainer />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/track" element={<PublicTracking />} />
          <Route path="*" element={<AppRoutes />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

const navStyle = ({ isActive }: { isActive: boolean }): React.CSSProperties => ({
  color: isActive ? "#93c5fd" : "#cbd5e1",
  textDecoration: "none",
  fontWeight: 500,
  fontSize: 14,
});
