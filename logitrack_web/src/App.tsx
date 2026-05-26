import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import { ToastContainer } from "./components/Toast";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { useIsMobile } from "./hooks/useIsMobile";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Sidebar } from "./components/Sidebar";
import { useSidebarOffset } from "./components/sidebarLayout";
import { Topbar } from "./components/Topbar";
import { TopbarProvider } from "./components/topbarContext";
import { NotificationsPage } from "./pages/NotificationsPage";
import { Dashboard } from "./pages/Dashboard";
import { KpiDetail } from "./pages/KpiDetail";
import { ShipmentList } from "./pages/ShipmentList";
import { ShipmentDetail } from "./pages/ShipmentDetail";
import { Claims } from "./pages/Claims";
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
import { AutoReports } from "./pages/AutoReports";
import { SupervisorFatigue } from "./pages/SupervisorFatigue";
import DriverScanVehicle from "./pages/DriverScanVehicle";
import { Repartos } from "./pages/Repartos";
import OperatorTripReception from "./pages/OperatorTripReception";
import { InterSucursal } from "./pages/InterSucursal";
import { InterBranchTripsList } from "./pages/InterBranchTripsList";

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

/** Layout wrapper for non-driver roles: sidebar (fixed) + topbar (sticky) + main with left offset. */
function AppShell({ children }: { children: React.ReactNode }) {
  const offset = useSidebarOffset();
  return (
    <TopbarProvider>
      <Sidebar />
      <div style={{
        marginLeft: offset,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        transition: "margin-left 0.18s ease",
      }}>
        <Topbar />
        <main style={{ flex: 1 }}>
          {children}
        </main>
      </div>
    </TopbarProvider>
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

  // Unauthenticated → only the login route, sin shell.
  if (!user) {
    return (
      <main>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </main>
    );
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/login" element={<Navigate to={user.role === "admin" ? "/admin/users" : "/"} replace />} />

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

        <Route path="/claims" element={
          <ProtectedRoute roles={["operator", "supervisor", "manager"]}>
            <Claims />
          </ProtectedRoute>
        } />

        <Route path="/claims/:id" element={
          <ProtectedRoute roles={["operator", "supervisor", "manager"]}>
            <Claims />
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

        <Route path="/reports/drivers" element={<Navigate to="/dashboard?tab=choferes" replace />} />
        <Route path="/reports/incidents" element={<Navigate to="/dashboard?tab=reclamos" replace />} />
        <Route path="/reports/billing" element={<Navigate to="/dashboard?tab=facturacion" replace />} />
        <Route path="/reports/branch-ranking" element={<Navigate to="/dashboard?tab=ranking" replace />} />
        <Route path="/reports/volume-by-window" element={<Navigate to="/dashboard?tab=volumen" replace />} />
        <Route path="/reports/return-metrics" element={<Navigate to="/dashboard?tab=retorno" replace />} />
        <Route path="/reports/success-rate" element={<Navigate to="/dashboard?tab=exito" replace />} />

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

        <Route path="/auto-reports" element={
          <ProtectedRoute roles={["manager", "admin"]}>
            <AutoReports />
          </ProtectedRoute>
        } />

        <Route path="*" element={<Navigate to={user.role === "admin" ? "/admin/users" : "/"} replace />} />
      </Routes>
      <ToastContainer />
    </AppShell>
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
