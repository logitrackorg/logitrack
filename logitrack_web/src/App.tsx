import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import { ToastContainer } from "./components/Toast";
import { SupervisorFatigueGuard } from "./components/SupervisorFatigueGuard";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { TwoFAGuard } from "./components/TwoFAGuard";
import { ThemeProvider } from "./context/ThemeContext";
import { OrganizationThemeProvider, useOrganizationTheme } from "./context/OrganizationThemeContext";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./components/ThemeToggle";
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
import { SlaAuditLogs } from "./pages/SlaAuditLogs";
import { SlaSettings } from "./pages/SlaSettings";
import { NewShipment } from "./pages/NewShipment";
import { PublicTracking } from "./pages/PublicTracking";
import { Login } from "./pages/Login";
import { DriverRoute } from "./pages/DriverRoute";
import { DriverInterBranchTrip } from "./pages/DriverInterBranchTrip";
import { DriverShipmentDetail } from "./pages/DriverShipmentDetail";
import { VehicleList } from "./pages/VehicleList";
import { VehicleStatus } from "./pages/VehicleStatus";
import { AvailableVehicles } from "./pages/AvailableVehicles";
import { VehicleAssignment } from "./pages/VehicleAssignment";
import { BranchList } from "./pages/BranchList";
import { MLConfig } from "./pages/MLConfig";
import { SystemConfig } from "./pages/SystemConfig";
import { PricingConfig } from "./pages/PricingConfig";
import { RoutingConfig } from "./pages/RoutingConfig";
import { PaymentConfig } from "./pages/PaymentConfig";
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
import { DriverScanVehicle } from "./pages/DriverScanVehicle";
import { Repartos } from "./pages/Repartos";
import { OperatorTripReception } from "./pages/OperatorTripReception";
import { InterSucursal } from "./pages/InterSucursal";
import { InterBranchTripsList } from "./pages/InterBranchTripsList";
import { TripsCalendar } from "./pages/TripsCalendar";
import { TwoFAVerify } from "./pages/TwoFAVerify";
import { TwoFASetup } from "./pages/TwoFASetup";
import { NetworkHub } from "./pages/NetworkHub";

function DriverNav() {
  const { user, logout } = useAuth();
  const { config: org } = useOrganizationTheme();
  const orgName = org?.name?.trim() || "LogiTrack";
  const logoUrl = org?.logo_url?.trim();
  const isMobile = useIsMobile();
  if (!user) return null;

  const isInterBranch = user.driver_type === "intersucursal";
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn("no-underline font-semibold text-base py-2", isActive ? "text-blue-300" : "text-slate-300");

  return (
    <nav className="bg-[var(--sidebar-bg)] text-white flex items-center px-4 gap-3 min-h-[56px] py-2">
      {logoUrl ? (
        <img src={logoUrl} alt={orgName} className="h-7 w-auto rounded" />
      ) : (
        <span className="font-extrabold text-[15px] tracking-[1px]">{orgName}</span>
      )}
      {isInterBranch ? (
        <NavLink to="/driver/trip" className={linkClass}>Mi viaje</NavLink>
      ) : (
        <NavLink to="/driver/route" className={linkClass}>Mi ruta</NavLink>
      )}

      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle compact />
        {isMobile ? (
          <NavLink to="/profile" className="no-underline">
            <span className="text-sm text-slate-200 font-semibold">{user.username}</span>
          </NavLink>
        ) : (
          <NavLink to="/profile" className="no-underline">
            <span className="text-[13px] text-slate-400 cursor-pointer">
              <strong className="text-slate-200 font-semibold">{user.username}</strong>
              {" · "}
              <span className="text-slate-500 bg-[#0f2744] px-2 py-0.5 rounded-[10px] text-xs">
                {isInterBranch ? "Chofer Intersucursal" : "Chofer"}
              </span>
            </span>
          </NavLink>
        )}
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
            <Route path="/profile" element={
              <ProtectedRoute roles={["driver"]}>
                <UserProfile />
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
    <SupervisorFatigueGuard>
    <AppShell>
      <Routes>
        <Route path="/login" element={<Navigate to={user.role === "admin" ? "/admin/users" : "/"} replace />} />

        <Route path="/dashboard" element={
          <ProtectedRoute roles={["supervisor", "manager"]}>
            <Dashboard />
          </ProtectedRoute>
        } />

        <Route path="/kpi-detail" element={
          <ProtectedRoute roles={["supervisor", "manager", "admin"]}>
            <KpiDetail />
          </ProtectedRoute>
        } />

        <Route path="/" element={
          <ProtectedRoute roles={["operator", "supervisor", "manager"]}>
            <ShipmentList />
          </ProtectedRoute>
        } />

        <Route path="/sla-audit" element={
          <ProtectedRoute roles={["supervisor", "manager"]}>
            <SlaAuditLogs />
          </ProtectedRoute>
        } />

        <Route path="/admin/sla-config" element={
          <ProtectedRoute roles={["admin"]}>
            <SlaSettings />
          </ProtectedRoute>
        } />

        <Route path="/claims" element={
          <ProtectedRoute roles={["admin", "operator", "supervisor", "manager"]}>
            <Claims />
          </ProtectedRoute>
        } />

        <Route path="/claims/:id" element={
          <ProtectedRoute roles={["admin", "operator", "supervisor", "manager"]}>
            <Claims />
          </ProtectedRoute>
        } />

        <Route path="/shipments/:trackingId" element={
          <ProtectedRoute roles={["operator", "supervisor", "manager"]}>
            <ShipmentDetail />
          </ProtectedRoute>
        } />

        <Route path="/calendar" element={
          <ProtectedRoute roles={["operator", "supervisor", "manager"]}>
            <TripsCalendar />
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

        <Route path="/vehicles/:plate/status" element={
          <ProtectedRoute roles={["supervisor", "admin"]}>
            <VehicleStatus />
          </ProtectedRoute>
        } />
        <Route path="/vehicles/:plate/assign" element={
          <ProtectedRoute roles={["supervisor", "admin"]}>
            <VehicleAssignment />
          </ProtectedRoute>
        } />
        <Route path="/vehicles/available" element={
          <ProtectedRoute roles={["supervisor", "admin"]}>
            <AvailableVehicles />
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

        <Route path="/payment-config" element={
          <ProtectedRoute roles={["admin"]}>
            <PaymentConfig />
          </ProtectedRoute>
        } />

        <Route path="/repartos" element={
          <ProtectedRoute roles={["operator", "supervisor"]}>
            <Repartos />
          </ProtectedRoute>
        } />

        <Route path="/inter-sucursal" element={
          <ProtectedRoute roles={["operator", "supervisor"]}>
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

        <Route path="/red" element={
          <ProtectedRoute roles={["manager", "admin"]}>
            <NetworkHub />
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

        <Route path="/auto-reports" element={
          <ProtectedRoute roles={["manager"]}>
            <AutoReports />
          </ProtectedRoute>
        } />

        <Route path="*" element={<Navigate to={user.role === "admin" ? "/admin/users" : "/"} replace />} />
      </Routes>
      <ToastContainer />
    </AppShell>
    </SupervisorFatigueGuard>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <OrganizationThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <TwoFAGuard>
            <Routes>
              <Route path="/track" element={<PublicTracking />} />
              {/* Rutas de 2FA: accesibles sin sesión establecida */}
<Route path="/2fa/verify" element={<TwoFAVerify />} />
<Route path="/2fa/setup-required" element={<TwoFASetup required />} />
<Route path="/2fa/setup" element={<TwoFASetup />} />
              <Route path="*" element={<AppRoutes />} />
            </Routes>
          </TwoFAGuard>
        </BrowserRouter>
      </AuthProvider>
      </OrganizationThemeProvider>
    </ThemeProvider>
  );
}

